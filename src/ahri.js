const { RequestAsync, ParseDOM, CheckMetaContainsChinese } = require('./util')

class Ahri
{
    constructor(url, useJpTitle = true, verbose = true) {
        this.url = url
        this.useJpTitle = useJpTitle
        this.verbose = verbose
        this.pics = []
    }

    async Run() {
        if(this.verbose) {
            console.log(`Start Run Ahri: ${this.title}`)

            const origin = new URL(this.url).origin
            const id = this.url.substring(this.url.lastIndexOf('=') + 1)

            const link = `${origin}/readOnline2.php?ID=${id}&host_id=0&page=0`
            const result = await RequestAsync(link)

            const http_image = result.match(/var HTTP_IMAGE = "(.*)";/)[1]
            const script = result.substring(
                    result.indexOf('Original_Image_List = [') + 'Original_Image_List = ['.length - 1,
                    result.indexOf(`"version":"0"}]`) + `"version":"0"}]`.length)
            
            try {
                const data = JSON.parse(script)                
                const pics = data.reduce((acc, ele) => {
                    const src = `${http_image}${ele['new_filename']}_w1100.${ele['extension']}`
                    return acc.concat({ href: src, id: ele.sort })
                }, [])
                this.pics = pics
            }
            catch (err) {
                throw err
            }
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
            isChinese : CheckMetaContainsChinese(this.title)
        }
    }

    async ParseName() {        
        const $ = this.DOM
        const title = $('.page-title a[href^="post"]').text().trim()
	    this.title = title
    }

    // only fetch one page, returns top 5 results
    static async Search(keywords, returnResults=5) {
        const url = `http://ahri-hentai.com/dnew.php?search=${encodeURI(keywords)}`
        const result = await RequestAsync(url)        
        const $ = ParseDOM(result)
        const blocks = $('.image')
        
        let candidates = []
        for(let i = 0; i < blocks.length; ++i) {

            if($('.ribbon-wrap', blocks[i]).length > 0 || $('.ribbon-wrap-left', blocks[i]).length > 0) {
                // animation or adult videos
                continue
            }
            const name = $('.title a', blocks[i]).text().trim()
            const href = 'http://ahri-hentai.com/' + $('.title a', blocks[i]).attr('href')
            const thumb = $('img', blocks[i]).attr('src')
            candidates.push({title: name, href: href, thumb: thumb})
        }

        candidates = candidates.sort((a, b) => { return (CheckMetaContainsChinese(a.title) && !CheckMetaContainsChinese(b.title)) ? -1 : 0 } ).splice(0, returnResults)

        return candidates
    }
}

module.exports.Ahri = Ahri