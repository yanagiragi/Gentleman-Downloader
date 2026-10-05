const { RequestAsync, CleanUpSearchParams, CheckMetaContainsChinese } = require('./util')

const APIBaseURL = 'https://nhentai.net/api/v2'
const ImageBaseURL = 'https://i.nhentai.net/'
const ThumbnailBaseURL = 'https://t.nhentai.net/'

async function RequestJSON (url) {
    const result = await RequestAsync(url)
    return JSON.parse(result)
}

class NH
{
    constructor(url, useJpTitle = true, verbose = true) {
        this.url = CleanUpSearchParams(url)
        this.useJpTitle = useJpTitle
        this.verbose = verbose
        this.pics = []
    }

    async Run() {
        if(this.verbose) {
            console.log(`Start Run NH: ${this.title}`)
        }

        const pages = this.gallery.pages || []
        if(this.verbose) {
            console.log(`Found ${pages.length} Pics On ${this.title}`)
        }

        for(let i = 0; i < pages.length; ++i){
            const href = new URL(pages[i].path, ImageBaseURL).toString()
            const pic = { href: href, id: (this.pics.length + 1) }
            this.pics.push(pic)
            if(this.verbose) {
                console.log(`Get ${i} pic src: ${href}`)
            }
        }
    }

    async Setup() {
        const galleryID = new URL(this.url).pathname.match(/^\/g\/(\d+)/)?.[1]
        if(galleryID == null) {
            throw new Error(`Invalid NH gallery URL: ${this.url}`)
        }

        this.gallery = await RequestJSON(`${APIBaseURL}/galleries/${galleryID}`)
        this.ParseName()
        this.ParseMeta()
    }

    async ParseMeta()
    {
        this.meta = {
            isChinese : CheckMetaContainsChinese(this.jpTitle) || CheckMetaContainsChinese(this.engTitle)
        }
    }

    async ParseName() {
        this.jpTitle = this.gallery.title.japanese || ''
        this.engTitle = this.gallery.title.english || ''
        this.title = this.useJpTitle
            ? (this.jpTitle || this.engTitle)
            : (this.engTitle || this.jpTitle)
    }

    // only fetch one page, returns top 5 results
    static async Search(keywords, returnResults=5) {
        const url = `${APIBaseURL}/search?query=${encodeURIComponent(keywords)}&sort=date&page=1`
        const response = await RequestJSON(url)
        const candidates = response.result
            .filter(gallery => gallery.blacklisted !== true)
            .map(gallery => ({
                title: gallery.english_title || gallery.japanese_title || '',
                href: `https://nhentai.net/g/${gallery.id}/`,
                thumb: new URL(gallery.thumbnail, ThumbnailBaseURL).toString()
            }))
            .sort((a, b) => { return (CheckMetaContainsChinese(a.title) && !CheckMetaContainsChinese(b.title)) ? -1 : 0 })
            .slice(0, returnResults)
        
        return candidates
    }
}

module.exports.NH = NH
