const fs = require('fs')
const path = require('path')

const { EH } = require('./eh')
const { GetRequestOptions, RequestAsync, ParseDOM, CheckMetaContainsChinese } = require('./util')

// eslint-disable-next-line no-undef
const CookiePath = path.join(__dirname, '..', 'ex-cookie.json')
const RequiredCookieNames = ['igneous', 'ipb_member_id', 'ipb_session_id', 'ipb_pass_hash']
const CookieHeaders = new WeakMap()

function LoadCookieHeader () {
    if (!fs.existsSync(CookiePath)) {
        throw new Error('ExHentai requires ex-cookie.json in the project root')
    }

    let cookies
    try {
        cookies = JSON.parse(fs.readFileSync(CookiePath, 'utf8'))
    }
    catch (_err) {
        throw new Error('Unable to parse ex-cookie.json')
    }

    if (!Array.isArray(cookies)) {
        throw new Error('ex-cookie.json must contain a browser cookie array')
    }

    const now = Date.now() / 1000
    const usableCookies = cookies.filter(cookie => {
        const domain = String(cookie.domain || '').replace(/^\./, '').toLowerCase()
        const hasValidName = typeof cookie.name === 'string' && /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(cookie.name)
        const hasValidValue = typeof cookie.value === 'string' && !/[;\r\n]/.test(cookie.value)
        const hasValidDomain = domain === 'exhentai.org' || domain.endsWith('.exhentai.org')
        const hasNotExpired = cookie.expirationDate == null || cookie.expirationDate > now
        return hasValidName && hasValidValue && hasValidDomain && hasNotExpired
    })
    const availableNames = new Set(usableCookies.map(cookie => cookie.name))
    if (RequiredCookieNames.some(name => !availableNames.has(name))) {
        throw new Error('ex-cookie.json is missing required ExHentai login cookies or they have expired')
    }

    return usableCookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ')
}

function IsExHentaiHost (hostname) {
    return hostname === 'exhentai.org' || hostname.endsWith('.exhentai.org')
}

async function RequestAuthenticated (url, cookieHeader, requestOptions = {}) {
    const parsedURL = new URL(url)
    if (!IsExHentaiHost(parsedURL.hostname)) {
        throw new Error(`Refusing to send ExHentai cookies to ${parsedURL.hostname}`)
    }

    const options = GetRequestOptions({ ...requestOptions, uri: parsedURL.toString() })
    options.headers.Cookie = cookieHeader
    return RequestAsync(options)
}

class EX extends EH {
    constructor (url, useJpTitle = true, verbose = true) {
        super(url, useJpTitle, verbose)
        CookieHeaders.set(this, LoadCookieHeader())
    }

    async RequestPage (url) {
        return RequestAuthenticated(url, CookieHeaders.get(this))
    }

    async Setup () {
        await super.Setup()
        if (!Number.isInteger(this.totalPageCount) || this.totalPageCount < 1 || !this.title) {
            throw new Error('Unable to access ExHentai gallery; check ex-cookie.json')
        }
    }

    static HasCookieFile () {
        return fs.existsSync(CookiePath)
    }

    static async RequestResource (url, requestOptions = {}) {
        return RequestAuthenticated(url, LoadCookieHeader(), requestOptions)
    }

    static async Search (keywords, returnResults = 5) {
        const url = `https://exhentai.org/?f_search=${encodeURIComponent(keywords)}`
        const result = await RequestAuthenticated(url, LoadCookieHeader())
        const $ = ParseDOM(result)
        let blocks = $('.glte tr').has('.glink')
        if (blocks.length === 0) {
            blocks = $('.gltc tr').has('.glink')
        }

        const candidates = []
        for (let i = 0; i < blocks.length; ++i) {
            const titleElement = $('.glink', blocks[i]).first()
            const title = titleElement.text().trim()
            const relativeHref = titleElement.closest('a').attr('href') || $('.gl3c a', blocks[i]).first().attr('href')
            const relativeThumb = $('.gl1e img', blocks[i]).first().attr('src') ||
                $('.gl2c .glthumb img', blocks[i]).first().attr('data-src') ||
                $('.gl2c .glthumb img', blocks[i]).first().attr('src')

            if (!title || !relativeHref || !relativeThumb) {
                continue
            }

            candidates.push({
                title: title,
                href: new URL(relativeHref, url).toString(),
                thumb: new URL(relativeThumb, url).toString()
            })
        }

        return candidates
            .sort((a, b) => (CheckMetaContainsChinese(a.title) && !CheckMetaContainsChinese(b.title)) ? -1 : 0)
            .slice(0, returnResults)
    }
}

module.exports.EX = EX
