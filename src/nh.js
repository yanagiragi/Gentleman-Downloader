const { RequestAsync, ParseDOM, CleanUpSearchParams, CheckMetaContainsChinese } = require('./util')

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
        
        const $ = this.DOM
        const pageCount = $('.thumb-container img').length
        if(pageCount === 0) {
            console.error(`Error On ${this.url}, maybe be 503 Service Temporarily Unavailable, will retry later.`)
        }

        const pics = $('.thumb-container a')
        if(this.verbose) {
            console.log(`Found ${pics.length} Pics On ${this.title}`)
        }

        for(let i = 0; i < pics.length; ++i){
            const href = new URL(`https://nhentai.net${$(pics[i]).attr('href')}`)
            const text = await RequestAsync(href.toString())
            const new$ = ParseDOM(text)
            const img = new$('#image-container img')
            const src = img.attr('src')
            const pic = { 'href': src, id: (this.pics.length + 1) }
            this.pics.push(pic)
            console.log(`Get ${i} pic src: ${src}`)
        }
    }

    async Setup() {
        const result = await RequestAsync(this.url)
        this.DOM = ParseDOM(result)
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
        const $ = this.DOM
        const jpTitle = $('#info h2').text()
        const engTitle = $('#info h1').text()	
        this.jpTitle = jpTitle
        this.engTitle = engTitle
        this.title = this.useJpTitle ? this.jpTitle : this.engTitle
    }

    // only fetch one page, returns top 5 results
    static async Search(keywords, returnResults=5) {
        const url = `https://nhentai.net/search/?q=${encodeURIComponent(keywords)}`
        const result = await RequestAsync(url)
        const $ = ParseDOM(result)
        const blocks = $('.gallery')
        
        let candidates = []
        
        for(let i = 0; i < blocks.length; ++i) {
            const name = $('.caption', blocks[i]).text()
            const href = 'https://nhentai.net' + $('a', blocks[i]).attr('href')
            const dataSrc =  $('.lazyload', blocks[i]).attr('data-src')
            const src = $('img', blocks[i]).attr('src')
            // for some result, thumbnails stores in src, else stores in data-src
            const thumb = (dataSrc != null && !dataSrc.includes('data:image/gif')) ? dataSrc : src
            candidates.push({title: name, href: href, thumb: thumb})
        }
        
        candidates = candidates.sort((a, b) => { return (CheckMetaContainsChinese(a.title) && !CheckMetaContainsChinese(b.title)) ? -1 : 0 } ).splice(0, returnResults)
        
        return candidates
    }
}

module.exports.NH = NH