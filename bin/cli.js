const path = require('path')
const fs = require('fs-extra')
const pMap = require('p-map')
const sanitize = require('sanitize-filename')

const { EH, NH, Wnacg, Ahri } = require('..')
const RequestAsync = require('request-promise')

const StoragePath = __dirname + '/Storage/'

if(require.main === module)
{
	(async () => {
        
        fs.ensureDirSync(StoragePath)
	
		const urls = process.argv.splice(2)	
		if(urls.length === 0){
			console.log("Example: node main.js $url [$url...]")
		}

		const mapper = async url => {
			return await Process(url)
		};

		const result = await pMap(urls, mapper, {concurrency: 5});
	})()
}

async function Process(url)
{
    let agent;
    if (url.includes('exhentai')) {
        agent = new EH(url.replace('exhentai', 'e-hentai'))        
	}
	else if (url.includes('e-hentai')) {
        agent = new EH(url)        
    }    
	else if (url.includes('nhentai')) {
		agent = new NH(url)
    }
    else if (url.includes('wnacg')) {
		agent = new Wnacg(url)
    }
    else if (url.includes('ahri')) {
		agent = new Ahri(url)
	}
    
    // Setup titles, totalPageCount, MetaDatas
    await agent.Setup()

    // Fetch Image Src
    await agent.Run()

    // Start Download Image, note we do not consider naming collision issues when create folder
    const filepath = path.join(StoragePath, sanitize(agent.title, { replacement: '_' }))
    fs.ensureDirSync(filepath)

    for(let i = 0; i < agent.pics.length; ++i) {
        const url = agent.pics[i].href
        const id = agent.pics[i].id
        const options = { uri : url, encoding : 'binary' }
        const extension = url.split('.').pop()
        const filename = path.join(filepath, `${id}.${extension}`)

        if(fs.existsSync(filename)) {
            console.log(`Skip ${filename}`)	
            continue
        }

        try {
            const body = await RequestAsync(options)

            console.log(`Save ${filename}`)	
            fs.writeFileSync(filename, body, 'binary')
        }
        catch (err) {
            console.error(`Error When Fetching ${url}`)
            console.log(JSON.stringify({url: url, filename: filename}, null, 4))
        }        
    }    
}