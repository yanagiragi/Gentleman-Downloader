const request = require('request');
const cheerio = require('cheerio');
const path = require('path');
const fs = require('fs-extra');
const sanitize = require('sanitize-filename')

const StoragePath = './Storage/'

if(require.main === module)
{
	fs.ensureDirSync(StoragePath)
	
	const urls = process.argv.splice(2)	
	if(urls.length === 0){
		console.log("Example: node main.js $url [$url...]")
	}

	urls.map(url => main(url.replace(/\?p=[0-9]*/, '')))
}

function getpic(url, filepath) {
	const EHoptions = url
	const NHOptions = { uri : url, encoding : 'binary' }
	const options = url.includes('t.nhentai.net') ? NHOptions : EHoptions
	request(options, (err, res, body) => {
		if(!err){
			const $ = cheerio.load(body)
			const src = $('#i3 img').attr('src')

			if (options === NHOptions){
				// case : NH
				const filename = path.join(filepath, sanitize(url.split('/').pop()))
				fs.writeFileSync(filename, body, 'binary')
			}
			else {
				// case : EH
				const filename = path.join(filepath, sanitize(src.split('/').pop()))
				
				// Only Download if not Exists
				if(!fs.existsSync(filename)){
					request.get( { uri : src, encoding : 'binary' }, (err, res, body) => {
						if(!err)
							fs.writeFileSync(filename, body, 'binary')
						else
							console.log(`Err with ${src}`)
					});
				}
			}		
		}
	})
}

function ParseNH(index, body) {
	const $ = cheerio.load(body)			
	const pageCount = $('.thumb-container img').length
	
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
		getpic(e.attr('data-src'), filepath)
	}

	return true
}

function ParseEH(index, body) {
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
			getpic(e.attr('href'), filepath)
		}

		return false
	}
}

function main(urlBase, index=0)
{
	const url = (index === 0) ? `${urlBase}` : `${urlBase}?p=${index}`
	request(url, (err, res, body) =>{
		if(!err){
			let shallBreak = false
			if (url.includes('e-hentai')) {
				shallBreak = ParseEH(index, body)
			}
			else if (url.includes('nhentai')) {
				shallBreak = ParseNH(index, body)
			}
			if (!shallBreak) {
				main(urlBase, index + 1)
			}
		}
	});
}