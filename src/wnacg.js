const { RequestAsync, ParseDOM, CleanUpSearchParams, CheckMetaContainsChinese } = require('./util')

class Wnacg
{
    constructor(url, verbose = true) {
        this.url = CleanUpSearchParams(url)
        this.verbose = verbose
        this.pics = []
    }

    async Run() {
        if(this.verbose) {
            console.log(`Start Run Wnacg: ${this.title}`)
        }
        
        const result = await RequestAsync(this.url.replace('photos-index-aid','download-index-aid'))
        const $ = ParseDOM(result)
        const link = $('.down_btn').attr('href')
        this.pics.push({ href: link, id: this.title })
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
            isChinese : CheckMetaContainsChinese(this.title)
        }
    }

    async ParseName() {        
        const $ = this.DOM
        const title = $('#bodywrap h2').text()		
        this.title = title
    }

     // only fetch one page, returns top 5 results
     static async Search(keywords, returnResults=5) {
        const url = `https://www.wnacg.org/albums-index-page-1-sname-${encodeURI(keywords)}.html`
        const result = await RequestAsync(url)        
        const $ = ParseDOM(result)
        const blocks = $('.gallary_item')        
        let candidates = []

        for(let i = 0; i < blocks.length; ++i) {
            const name = $('.title a', blocks[i]).text()
            const href = 'https://www.wnacg.org/' + $('.title a', blocks[i]).attr('href')
            const thumb = 'https:' + $('img', blocks[i]).attr('src')

            candidates.push({title: name, href: href, thumb: thumb})
        }

        candidates = candidates.sort((a, b) => { return (CheckMetaContainsChinese(a.title) && !CheckMetaContainsChinese(b.title)) ? -1 : 0 } ).splice(0, returnResults)

        return candidates
    }
}

module.exports.Wnacg = Wnacg