const { RequestAsync, ParseDOM, CleanUpSearchParams, CheckMetaContainsChinese } = require('./util')

class EH
{
    constructor(url, useJpTitle = true, verbose = true) {
        this.url = CleanUpSearchParams(url)
        this.useJpTitle = useJpTitle
        this.verbose = verbose
        this.pics = []
    }

    async Run() {
        if(this.verbose) {
            console.log(`Start Run EH: ${this.title}, totalPageCount = ${this.totalPageCount}`)
        }

        for(let i = 0; i < this.totalPageCount; ++i) {
            const url = `${this.url}?p=${i}`
            
            const result = await RequestAsync(url)
            const $ = ParseDOM(result)

            // .gdtl for ex, .gdtm for eh
            const pics = $('.gdtm').length == 0 ? $('.gdtl') : $('.gdtm')

            if(this.verbose) {
                console.log(`Found ${pics.length} Pics On ${this.title}, pagecount = ${i+1}/${this.totalPageCount}`)
            }

            for(let j = 0; j < pics.length; ++j){
                const e = $('a', pics[j])
                const src = await this.GetPicSrc(e.attr('href'))
                const pic = { 'href': src, id: (this.pics.length + 1) }
                this.pics.push(pic)
            }
        }
    }

    async GetPicSrc(url) {
        const result = await RequestAsync(url)    
        const $ = ParseDOM(result)
        const src = $('#i3 img').attr('src')
        return src
    }

    async Setup() {
        const result = await RequestAsync(this.url)
        this.DOM = ParseDOM(result)
        this.ParseTotalPageCount()
        this.ParseName()
        this.ParseMeta()
    }

    async ParseMeta()
    {
        this.meta = {
            isChinese : CheckMetaContainsChinese(this.jpTitle) || CheckMetaContainsChinese(this.engTitle)
        }
    }

    async ParseTotalPageCount() {
        const $ = this.DOM
        const pageCount = $('.ptt td a')
            .toArray()
            .map(x => parseInt($(x).text()))
            .filter(Number.isInteger) // get rid of '<' and '>'
            .sort((a,b) => a - b)
            .pop()
        this.totalPageCount = parseInt(pageCount)
    }

    async ParseName() {
        const $ = this.DOM
        const jpTitle = $('#gd2 #gj').text()
        const engTitle = $('#gd2 #gn').text()
        this.jpTitle = jpTitle
        this.engTitle = engTitle
        
        this.title = this.useJpTitle ? this.jpTitle : this.engTitle
    }

    // only fetch one page, returns top 5 results
    static async Search(keywords, returnResults=5) {
        const url = `https://e-hentai.org/?f_search=${encodeURIComponent(keywords)}`
        const result = await RequestAsync(url)
        const $ = ParseDOM(result)
        const blocks = $('.gltc tr')

        let candidates = []

        for(let i = 0; i < blocks.length; ++i) {
            const name = $('.glink', blocks[i]).text()
            const href = $('.gl3c a', blocks[i]).attr('href')
            const thumb = $('.gl2c .glthumb img', blocks[i]).attr('data-src')

            if(name.length == 0) {
                continue
            }

            candidates.push({title: name, href: href, thumb: thumb})
        }

        candidates = candidates.sort((a, b) => { return (CheckMetaContainsChinese(a.title) && !CheckMetaContainsChinese(b.title)) ? -1 : 0 } ).splice(0, returnResults)

        return candidates
    }
}

module.exports.EH = EH