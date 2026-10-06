/* eslint-env node */
const express = require('express')
const path = require('path')
const crypto = require('crypto')
const { Buffer } = require('buffer')
const bodyParser = require('body-parser')
const cookieParser = require('cookie-parser')
const helmet = require('helmet')
const pMap = require('p-map')
const { EH, EX, NH, Wnacg, Ahri } = require('..')
const { DownloadGallery, RetryFailedDownloads } = require('../src/downloader')

const app = express()

const PORT = process.env.PORT || 3004
const PASSWORD = process.env.GDW_PASSWORD || 'pass'
const AUTH_ENABLED = !['0', 'false', 'no', 'off'].includes(
    String(process.env.GDW_AUTH_ENABLED || 'true').toLowerCase()
)
const TOKEN = Date.now().toString()
const MAX_DOWNLOAD_URLS = 50
const MAX_DOWNLOAD_JOBS = 100
const DOWNLOAD_JOB_TTL = 1000 * 60 * 60
const EX_THUMBNAIL_URL_TTL = 1000 * 60 * 60
const EX_THUMBNAIL_MAX_SIZE = 5 * 1024 * 1024
const EX_THUMBNAIL_SECRET = crypto.randomBytes(32)
const downloadJobs = new Map()
let activeRetryJobId = null

function SignEXThumbnailURL (url, expires) {
    return crypto.createHmac('sha256', EX_THUMBNAIL_SECRET)
        .update(`${expires}\n${url}`)
        .digest('hex')
}

function CreateEXThumbnailURL (remoteURL) {
    const url = new URL(remoteURL).toString()
    const expires = Date.now() + EX_THUMBNAIL_URL_TTL
    const signature = SignEXThumbnailURL(url, expires)
    return `/ex-thumbnail?url=${encodeURIComponent(url)}&expires=${expires}&signature=${signature}`
}

function ValidateEXThumbnailURL (urlValue, expiresValue, signatureValue) {
    if (typeof urlValue !== 'string' || urlValue.length > 2048 ||
        typeof expiresValue !== 'string' || !/^\d+$/.test(expiresValue) ||
        typeof signatureValue !== 'string' || !/^[a-f0-9]{64}$/.test(signatureValue)) {
        return null
    }

    const expires = Number(expiresValue)
    if (!Number.isSafeInteger(expires) || expires < Date.now() || expires > Date.now() + EX_THUMBNAIL_URL_TTL) {
        return null
    }

    let url
    try {
        url = new URL(urlValue)
    }
    catch (_err) {
        return null
    }
    if (url.protocol !== 'https:' || url.hostname !== 's.exhentai.org' || url.port !== '' ||
        url.username !== '' || url.password !== '' || !/\.(?:gif|jpe?g|png|webp)$/i.test(url.pathname)) {
        return null
    }

    const expected = Buffer.from(SignEXThumbnailURL(url.toString(), expiresValue), 'hex')
    const actual = Buffer.from(signatureValue, 'hex')
    return crypto.timingSafeEqual(expected, actual) ? url.toString() : null
}

function DetectImageType (data) {
    if (data.length >= 12 && data.subarray(0, 4).toString('ascii') === 'RIFF' &&
        data.subarray(8, 12).toString('ascii') === 'WEBP') {
        return 'image/webp'
    }
    if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
        return 'image/jpeg'
    }
    if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
        return 'image/png'
    }
    if (data.length >= 6 && ['GIF87a', 'GIF89a'].includes(data.subarray(0, 6).toString('ascii'))) {
        return 'image/gif'
    }
    return null
}

function CreateDownloadJob (urls, kind = 'download') {
    if (downloadJobs.size >= MAX_DOWNLOAD_JOBS) {
        return null
    }

    const now = new Date().toISOString()
    const job = {
        id: crypto.randomUUID(),
        kind: kind,
        status: 'running',
        submitted: urls.length,
        succeeded: 0,
        failed: 0,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
        items: urls.map(url => ({
            url: url,
            title: null,
            status: 'queued',
            completed: 0,
            total: 0,
            failed: 0
        }))
    }
    downloadJobs.set(job.id, job)
    return job
}

function UpdateDownloadJob (job, itemIndex, progress) {
    Object.assign(job.items[itemIndex], progress)
    job.updatedAt = new Date().toISOString()
}

function FinishDownloadJob (job) {
    job.status = 'completed'
    job.completedAt = new Date().toISOString()
    job.updatedAt = job.completedAt

    const cleanupTimer = setTimeout(() => downloadJobs.delete(job.id), DOWNLOAD_JOB_TTL)
    cleanupTimer.unref()
}

function FailDownloadJob (job, err) {
    job.status = 'failed'
    job.error = String(err)
    job.completedAt = new Date().toISOString()
    job.updatedAt = job.completedAt

    const cleanupTimer = setTimeout(() => downloadJobs.delete(job.id), DOWNLOAD_JOB_TTL)
    cleanupTimer.unref()
}

async function RunDownloadJob (job, urls) {
    try {
        const results = await pMap(urls, async (url, index) => {
            const result = await DownloadGallery(url, {
                onProgress: progress => UpdateDownloadJob(job, index, progress)
            })

            if (result.success) {
                job.succeeded += 1
            }
            else {
                job.failed += 1
            }
            job.updatedAt = new Date().toISOString()
            return result
        }, { concurrency: 3 })

        FinishDownloadJob(job)
        return results
    }
    catch (err) {
        FailDownloadJob(job, err)
        return []
    }
}

async function RunRetryJob (job) {
    try {
        const result = await RetryFailedDownloads({
            onProgress: progress => {
                UpdateDownloadJob(job, 0, progress)
                job.submitted = progress.total
                job.failed = progress.failed
                job.succeeded = Math.max(0, progress.completed - progress.failed)
            }
        })

        if (result.error) {
            throw new Error(result.error)
        }

        job.submitted = result.total
        job.succeeded = result.succeeded
        job.failed = result.failed
        FinishDownloadJob(job)
        return result
    }
    catch (err) {
        FailDownloadJob(job, err)
        return null
    }
    finally {
        activeRetryJobId = null
    }
}

function ValidateDownloadURL (value) {
    if (typeof value !== 'string' || value.length > 2048) {
        return null
    }

    let url
    try {
        url = new URL(value)
    }
    catch (_err) {
        return null
    }

    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.port !== '') {
        return null
    }

    const rules = {
        'e-hentai.org': /^\/g\/\d+\/[a-f0-9]+\/?$/i,
        'exhentai.org': /^\/g\/\d+\/[a-f0-9]+\/?$/i,
        'nhentai.net': /^\/g\/\d+\/?$/,
        'wnacg.com': /^\/photos-index-aid-\d+\.html$/,
        'www.wnacg.com': /^\/photos-index-aid-\d+\.html$/,
        'ahri8.monster': /^\/post\.php$/
    }
    const pathRule = rules[url.hostname]
    if (pathRule == null || !pathRule.test(url.pathname)) {
        return null
    }
    if (url.hostname === 'ahri8.monster' && !/^\d+$/.test(url.searchParams.get('ID') || '')) {
        return null
    }
    if (url.hostname === 'ahri8.monster') {
        const queryKeys = [...url.searchParams.keys()]
        if (queryKeys.length !== 1 || queryKeys[0] !== 'ID') {
            return null
        }
    }
    else if (url.search !== '') {
        return null
    }

    url.hash = ''
    return url.toString()
}

app.use(helmet())
// app.use(cors())
app.use(cookieParser(TOKEN))
app.use(bodyParser.urlencoded({ extended: false }))
app.use(bodyParser.json())
app.use(express.static(path.join(__dirname, 'assets')))

app.use(function (req, res, next) {
    let ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress
    if (ip && req.path) {
        console.log(`Request from ${ip}, path = ${req.path}`)
    } else {
        console.log(`Request from ????, path = ${req.path}`)
    }

    const whiteList = ['/login', '/favicon.ico']
    if (!AUTH_ENABLED || whiteList.includes(req.path) || (req.signedCookies && req.signedCookies.auth === TOKEN)) {
        next()
    }
    else {
        res.redirect('/login')
    }
})

app.get('/', (req, res) => {
    let data = path.join(__dirname, 'index.html')
    res.sendFile(data)
})

app.get('/login', (req, res) => {
    if (!AUTH_ENABLED || (req.signedCookies && req.signedCookies.auth === TOKEN)) {
        res.redirect('/')
    }
    else {
        let data = path.join(__dirname, 'login.html')
        res.sendFile(data)
    }
})

app.post('/login', (req, res) => {
    if (!AUTH_ENABLED) {
        return res.redirect('/')
    }

    if (req.body.password === PASSWORD) {
        const secure = req.secure || req.headers['x-forwarded-proto'] === 'https'
        res.cookie('auth', TOKEN, {
            signed: true,
            httpOnly: true,
            sameSite: 'strict',
            secure: secure,
            maxAge: 1000 * 60 * 60 * 24 * 365
        })
        res.redirect('/')
    }
    else {
        res.redirect('/login')
    }
})

app.get('/ex-thumbnail', async (req, res) => {
    const remoteURL = ValidateEXThumbnailURL(req.query.url, req.query.expires, req.query.signature)
    if (remoteURL == null) {
        return res.status(400).send({ error: 'Invalid thumbnail URL' })
    }

    try {
        const image = await EX.RequestResource(remoteURL, {
            encoding: 'binary',
            size: EX_THUMBNAIL_MAX_SIZE
        })
        if (!Buffer.isBuffer(image)) {
            throw new Error('Empty thumbnail response')
        }
        const contentType = DetectImageType(image)
        if (contentType == null) {
            throw new Error('Invalid thumbnail response')
        }

        res.set('Content-Type', contentType)
        res.set('Cache-Control', 'private, max-age=3600')
        res.set('X-Content-Type-Options', 'nosniff')
        res.send(image)
    }
    catch (err) {
        console.error(`Unable to fetch ExHentai thumbnail: ${err}`)
        res.status(502).send({ error: 'Unable to fetch thumbnail' })
    }
})

app.get('/search', async (req, res) => {
    const keyword = req.query.param
    if (typeof keyword !== 'string' || keyword.length > 200) {
        return res.status(400).send({ error: 'Invalid search keyword' })
    }

    try {
        const slice = 20
        const useEX = EX.HasCookieFile()
        const primaryType = useEX ? 'EX' : 'EH'
        const primaryResults = useEX ? await EX.Search(keyword, slice) : await EH.Search(keyword, slice)
        if (useEX) {
            for (const result of primaryResults) {
                result.thumb = CreateEXThumbnailURL(result.thumb)
            }
        }

        const NHResults = await NH.Search(keyword, slice)
        const WnacgResults = await Wnacg.Search(keyword, slice)
        const AhriResults = await Ahri.Search(keyword, slice)
        const results = {
            [primaryType]: primaryResults,
            NH: NHResults,
            Wnacg: WnacgResults,
            Ahri: AhriResults
        }

        res.send(results)
    }
    catch (err) {
        console.error(`Search failed: ${err}`)
        res.status(502).send({ error: 'Search failed' })
    }
})

app.post('/download', (req, res) => {
    if (!req.is('application/json')) {
        return res.status(415).send({ error: 'JSON request required' })
    }

    const submittedURLs = req.body?.urls
    if (!Array.isArray(submittedURLs) || submittedURLs.length === 0 || submittedURLs.length > MAX_DOWNLOAD_URLS) {
        return res.status(400).send({ error: `Submit between 1 and ${MAX_DOWNLOAD_URLS} URLs` })
    }

    const urls = submittedURLs.map(ValidateDownloadURL)
    if (urls.some(url => url == null)) {
        return res.status(400).send({ error: 'One or more URLs are not supported' })
    }

    const activeRetryJob = activeRetryJobId == null ? null : downloadJobs.get(activeRetryJobId)
    if (activeRetryJob?.status === 'running') {
        return res.status(409).send({ error: 'Wait for the retry job to finish before starting a download' })
    }

    const uniqueURLs = [...new Set(urls)]
    const job = CreateDownloadJob(uniqueURLs)
    if (job == null) {
        return res.status(503).send({ error: 'Too many download jobs' })
    }

    RunDownloadJob(job, uniqueURLs)
    res.status(202).send(job)
})

app.post('/download/retry', (req, res) => {
    const activeRetryJob = activeRetryJobId == null ? null : downloadJobs.get(activeRetryJobId)
    if (activeRetryJob?.status === 'running') {
        return res.status(202).send(activeRetryJob)
    }

    const hasActiveDownload = [...downloadJobs.values()].some(job =>
        job.kind === 'download' && job.status === 'running'
    )
    if (hasActiveDownload) {
        return res.status(409).send({ error: 'Wait for the current download job to finish before retrying' })
    }

    const job = CreateDownloadJob(['err.json'], 'retry')
    if (job == null) {
        return res.status(503).send({ error: 'Too many download jobs' })
    }

    job.items[0].title = 'Retry failed downloads'
    activeRetryJobId = job.id
    RunRetryJob(job)
    res.status(202).send(job)
})

app.get('/download/:jobId', (req, res) => {
    const job = downloadJobs.get(req.params.jobId)
    if (job == null) {
        return res.status(404).send({ error: 'Download job not found' })
    }
    res.set('Cache-Control', 'no-store')
    res.send(job)
})

if (require.main === module) {
    app.listen(PORT)
}

module.exports = { app, ValidateDownloadURL }
