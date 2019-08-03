const request = require('request');
const rp = require('request-promise');
const cheerio = require('cheerio');
const path = require('path');
const fs = require('fs-extra');
const sanitize = require('sanitize-filename')

const StoragePath = './Storage/'

if(require.main === module)
{
	(async () => {
		fs.ensureDirSync(StoragePath)
	
		const urls = process.argv.splice(2)	
		if(urls.length === 0){
			console.log("Example: node main.js $url [$url...]")
		}

		for (const url of urls) {
			let res = await main(url.replace(/\?p=[0-9]*/, ''))
		}
	})()
}

async function getpic(url, filepath) {
	const EHoptions = url
	const NHOptions = { uri : url, encoding : 'binary' }
	const options = url.includes('nhentai.net') ? NHOptions : EHoptions
	
	const body = await rp(options)

	const $ = cheerio.load(body)
	const src = $('#i3 img').attr('src')

	if (options === NHOptions){
		// case : NH
		const filename = path.join(filepath, sanitize(url.split('/').pop()))
		console.log(`Save ${filename}`)	
		fs.writeFileSync(filename, body, 'binary')
	}
	else {
		// case : EH
		const filename = path.join(filepath, sanitize(src.split('/').pop()))
		
		// Only Download if not Exists
		if(!fs.existsSync(filename)){
			const body = await rp({ uri : src, encoding : 'binary' })
			fs.writeFileSync(filename, body, 'binary')			
		}
	}		
}

async function ParseNH(url, body, index) {
	const $ = cheerio.load(body)			
	const pageCount = $('.thumb-container img').length
	
	if(pageCount === 0) {
		console.log(`Error On ${url}, maybe be 503 Service Temporarily Unavailable, will retry later.`)
		return false
	}

	// use japanese name, else use english
	const jpTitle = $('#info h2').text()
	const engTitle = $('#info h1').text()
	const title = jpTitle
	
	const filepath = path.join(StoragePath, sanitize(title, { replacement: '_' }))
	fs.ensureDirSync(filepath)
	
	const pics = $('.thumb-container a')
	console.log(`Found ${pics.length} Pics On ${title}`)

	for(let i = 0; i < pics.length; ++i){
		let e = $('img', pics[i])
		let src = new URL(e.attr('data-src'))
		src = `${src.origin.replace('t.', 'i.')}${src.pathname.replace('t.', '.')}`
		await getpic(src, filepath)
	}

	return true
}

async function ParseEH(url, body, index) {
	const $ = cheerio.load(body)			
	const pageCount = $('.ptt td a')
		.toArray()
		.filter(x => x.type && x.type === 'tag')
		.map(x => parseInt(x.children[0].data)) // equal to split of $('.ptt td a').text()
		.filter(Number.isInteger) // get rid of '<' and '>'
		.sort()
		.pop()

	if(index >= pageCount) {
		return true
	}
	else {
		// use japanese name, else use english
		const jpTitle = $('#gd2 #gj').text()
		const engTitle = $('#gd2 #gn').text()
		const title = jpTitle
		
		const filepath = path.join(StoragePath, sanitize(title, { replacement: '_' }))
		fs.ensureDirSync(filepath)
		
		const pics = $('.gdtm')
		console.log(`Found ${pics.length} Pics On ${title}, pagecount = ${index+1}/${pageCount}`)

		for(let i = 0; i < pics.length; ++i){
			let e = $('a', pics[i])
			await getpic(e.attr('href'), filepath)
		}

		return false
	}
}

async function main(urlBase, index=0)
{
	const url = (index === 0) ? `${urlBase}` : `${urlBase}?p=${index}`
	const body = await rp(url)
		
	let shallBreak = false
	if (url.includes('e-hentai')) {
		shallBreak = ParseEH(url, body, index)
	}
	else if (url.includes('nhentai')) {
		shallBreak = await ParseNH(url, body, index)
	}
	if (!shallBreak) {
		console.log(`Looping ${urlBase}, index = ${index}`)
		return await main(urlBase, index + 1)
	}
}