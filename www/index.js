/* eslint-env node */
const express = require('express')
const path = require('path')
const bodyParser = require('body-parser')
const cookieParser = require('cookie-parser')
const helmet = require('helmet')
const pMap = require('p-map')
const { EH, NH, Wnacg, Ahri } = require('..')
const { DownloadGallery } = require('../src/downloader')

const app = express()

const PORT = process.env.PORT || 3004
const PASSWORD = process.env.GDW_PASSWORD || 'pass'
const TOKEN = Date.now().toString()
const MAX_DOWNLOAD_URLS = 50

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
    if (whiteList.includes(req.path) || (req.signedCookies && req.signedCookies.auth === TOKEN)) {
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
    if (req.signedCookies && req.signedCookies.auth === TOKEN) {
        res.redirect('/')
    }
    else {
        let data = path.join(__dirname, 'login.html')
        res.sendFile(data)
    }
})

app.post('/login', (req, res) => {
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

app.post('/download', async (req, res) => {
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

    const uniqueURLs = [...new Set(urls)]
    const results = await pMap(uniqueURLs, DownloadGallery, { concurrency: 3 })
    const succeeded = results.filter(result => result?.success === true).length

    res.send({ submitted: uniqueURLs.length, succeeded, failed: uniqueURLs.length - succeeded })
})

if (require.main === module) {
    app.listen(PORT)
}

module.exports = { app, ValidateDownloadURL }
