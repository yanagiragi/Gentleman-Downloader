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
}

module.exports.Wnacg = Wnacg