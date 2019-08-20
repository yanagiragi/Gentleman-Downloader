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
		const urls = process.argv.splice(2)	
		if(urls.length === 0){
			console.log("Example: node main.js $keyword [$keyword...]")
		}

		const mapper = async url => {
			return await Process(url)
		};

		const result = await pMap(urls, mapper, {concurrency: 5});
	})()
}

async function Process(keyword)
{
    const EHResults = await EH.Search(keyword)
    const NHResults = await NH.Search(keyword)
    const WnacgResults = await Wnacg.Search(keyword)
    const AhriResults = await Ahri.Search(keyword)

    const results = {EH: EHResults, NH: NHResults, Wnacg: WnacgResults, Ahri: AhriResults }
    
    console.log(`keyword = ${keyword}`)
    console.log(JSON.stringify(results, null, 4))
    console.log('')
}