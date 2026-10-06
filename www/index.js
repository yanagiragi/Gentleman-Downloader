/* eslint-env node */
const express = require('express')
const path = require('path')
const crypto = require('crypto')
const bodyParser = require('body-parser')
const cookieParser = require('cookie-parser')
const helmet = require('helmet')
const pMap = require('p-map')
const { EH, NH, Wnacg, Ahri } = require('..')
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
const downloadJobs = new Map()
let activeRetryJobId = null

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

app.get('/search', async (req, res) => {
    const keyword = req.query.param
    const slice = 20
    const EHResults = await EH.Search(keyword, slice)
    const NHResults = await NH.Search(keyword, slice)
    const WnacgResults = await Wnacg.Search(keyword, slice)
    const AhriResults = await Ahri.Search(keyword, slice)
    const results = { EH: EHResults, NH: NHResults, Wnacg: WnacgResults, Ahri: AhriResults }

    res.send(results)
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
