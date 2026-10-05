const crypto = require('crypto')
const { Buffer } = require('buffer')
const { ParseDOM, GetRequestOptions, CheckMetaContainsChinese } = require('./util')

const BaseURL = 'https://ahri8.monster/'
const LegacyHosts = new Set(['ahri-hentai.com', 'www.ahri-hentai.com', 'ahri8.com', 'www.ahri8.com', 'ahri8.top', 'www.ahri8.top'])

// Ahri returns a fake "article not found" page to node-fetch v2 even when the
// same URL has valid search results. Node's native fetch receives the actual
// page, so Ahri uses it as a site-specific transport while still sharing the
// standard request headers and timeout from GetRequestOptions().
async function RequestAhri (url) {
    const options = GetRequestOptions(url)
    const response = await globalThis.fetch(options.uri, {
        headers: options.headers,
        signal: globalThis.AbortSignal.timeout(options.timeout)
    })
    if(!response.ok) {
        throw new Error(`Request failed with status ${response.status}: ${options.uri}`)
    }
    return response.text()
}

function NormalizeURL (url) {
    const normalized = new URL(url, BaseURL)
    if(LegacyHosts.has(normalized.hostname)) {
        normalized.protocol = 'https:'
        normalized.host = new URL(BaseURL).host
    }
    return normalized.toString()
}

function DecryptText (html, encryptedText) {
    const iv = html.match(/var aei = '([^']+)'/)?.[1]
    const key = html.match(/var aek = '([^']+)'/)?.[1]
    if(iv == null || key == null || encryptedText.length === 0) {
        return encryptedText
    }

    const decipher = crypto.createDecipheriv('aes-128-cbc', Buffer.from(key), Buffer.from(iv))
    return decipher.update(encryptedText, 'base64', 'utf8') + decipher.final('utf8')
}

class Ahri
{
    constructor(url, useJpTitle = true, verbose = true) {
        this.url = NormalizeURL(url)
        this.useJpTitle = useJpTitle
        this.verbose = verbose
        this.pics = []
    }

    async Run() {
        if(this.verbose) {
            console.log(`Start Run Ahri: ${this.title}`)
        }

        const origin = new URL(this.url).origin
        const id = new URL(this.url).searchParams.get('ID')
        const link = `${origin}/readOnline2.php?ID=${id}&host_id=0&page=0`
        const result = await RequestAhri(link)

        const imageBaseURL = result.match(/var HTTP_IMAGE = "([^"]+)";/)?.[1]
        const imageList = result.match(/Original_Image_List\s*=\s*(\[[\s\S]*?\]);/)?.[1]
        if(imageBaseURL == null || imageList == null) {
            throw new Error(`Unable to parse Ahri image list: ${link}`)
        }

        const data = JSON.parse(imageList)
        this.pics = data.map(image => ({
            href: `${imageBaseURL}${image.new_filename}_w1100.${image.extension}`,
            id: image.sort
        }))
    }

    async Setup() {
        const result = await RequestAhri(this.url)
        this.html = result
        this.DOM = ParseDOM(result)
        this.ParseName()
        this.ParseMeta()
    }

    async ParseMeta()
    {
        this.meta = {
            isChinese : CheckMetaContainsChinese(this.title)
        }
    }

    async ParseName() {
        const $ = this.DOM
        const encryptedTitle = $('.page-title a[href^="post"]').text().trim()
        this.title = DecryptText(this.html, encryptedTitle)
    }

    // only fetch one page, returns top 5 results
    static async Search(keywords, returnResults=5) {
        const url = new URL('dnew.php', BaseURL)
        url.searchParams.set('search', keywords)
        const result = await RequestAhri(url.toString())
        const $ = ParseDOM(result)
        const blocks = $('.image')
        
        let candidates = []
        for(let i = 0; i < blocks.length; ++i) {

            if($('.ribbon-wrap', blocks[i]).length > 0 || $('.ribbon-wrap-left', blocks[i]).length > 0) {
                // animation or adult videos
                continue
            }
            const titleLink = $('.title a', blocks[i])
            const encryptedName = titleLink.attr('title') || titleLink.text().trim()
            const relativeHref = titleLink.attr('href')
            const image = $('img', blocks[i])
            const thumb = image.attr('data-src') || image.attr('src')
            if(encryptedName == null || !relativeHref?.startsWith('post.php?ID=') || thumb == null) {
                continue
            }

            const name = DecryptText(result, encryptedName)
            const href = new URL(relativeHref, BaseURL).toString()
            candidates.push({title: name, href: href, thumb: thumb})
        }

        candidates = candidates.sort((a, b) => { return (CheckMetaContainsChinese(a.title) && !CheckMetaContainsChinese(b.title)) ? -1 : 0 } ).splice(0, returnResults)

        return candidates
    }
}

module.exports.Ahri = Ahri
