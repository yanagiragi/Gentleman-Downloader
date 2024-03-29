const fs = require('fs')
const path = require('path')
const fetch = require('node-fetch')
const cheerio = require('cheerio')

// eslint-disable-next-line no-undef
const cookie = fs.existsSync(path.join(__dirname, 'cookie.txt')) ? fs.readFileSync(path.join(__dirname, 'cookie.txt')) : ''
const timeout = 30 // unit: seconds

function FormURI (link) {
    return new URL(link).toString()
}

function GetRequestOptions (opts) {
    const defaultOptions = { 
        uri: '', 
        timeout: 1000 * timeout,
        headers : {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:68.0) Gecko/20100101 Firefox/68.0',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'zh-TW,zh;q=0.8,en-US;q=0.5,en;q=0.3',
            // 'Accept-Encoding': 'gzip, deflate, br',
            'DNT': '1',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Pragma': 'no-cache',
            'Cache-Control': 'no-cache',
            'Cookie': cookie
        }
    }

    // Syntactic sugars:
    // passing url<string> as opts
    // passing {url: url<string>} instead of uri
    const options = Object.assign(defaultOptions, typeof opts === 'object' ? opts : { uri: opts })
    options.uri = (options.uri === '' || options.uri === undefined) ? options.url : options.uri
    options.uri = FormURI(options.uri)
    options.uri = (options.uri.includes('exhentai') && cookie == '') ? options.uri.replace('exhentai', 'e-hentai') : options.uri
    return options
}

async function RequestAsync (opts) {
    const options = GetRequestOptions(opts)
    try {
        const response = await fetch(options.uri, options)
        if(response.ok){
            return await response.text()
        } else {
            throw response
        }
    }
    catch(err) {
        if(opts.treatErrorAsNormalCase !== true){
            const isTimeoutCase = err.type === 'request-timeout' || (err.size === 0 && err.timeout === timeout * 1000)
            if (!isTimeoutCase) {
                console.error(`Error On: ${options.uri}`)
                console.error(`\t Message = ${JSON.stringify(err)}`)
                throw err
            }
            else {
                console.log(`Timeout On: ${options.uri}`)
                console.log(`\t Message = ${JSON.stringify(err)}`)
            }
        }
        else {
            throw err
        }
    }
}

function ParseDOM (content, opts = {}) {
    return cheerio.load(content, opts)
}

function CleanUpSearchParams(link) {
    const l = new URL(link)
    l.search = ''
    return l.toString()
}

function CheckMetaContainsChinese(str) {
    const match = ['中国翻訳', '漢化', '汉化', 'Chinese']
    
    for (const pattern of match) {
        if( str.includes(pattern) ){
            return true
        }
    }

    return false
}

module.exports = {
    RequestAsync, ParseDOM, GetRequestOptions, CleanUpSearchParams, CheckMetaContainsChinese
}
