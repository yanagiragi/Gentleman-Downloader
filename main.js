const request = require('request');
const fs = require('fs');
const cheerio = require('cheerio');

const StoragePath = './Storage/'

if(require.main === module)
{
	if(!fs.existsSync(StoragePath))
		fs.mkdirSync(StoragePath)
	
	let urls = process.argv.splice(2)
	
	if(urls.length === 0){
		console.log("Example: node main.js $url [$url...]")
	}

	urls.map(url => main(url.replace(/\?p=[0-9]*/, '')))
}

function getpic(url, path){
	request(url, (err, res , body) => {
		if(!err){
			let $ = cheerio.load(body)
			let src = $('#i3 img')[0].attribs.src
			let filename = path + src.substr(src.lastIndexOf('/')+1)
			
			// Only Download if not Exists
			if(!fs.existsSync(filename)){
				request.get( {url : src, encoding : 'binary'}, (err, res, body) => {
					if(!err)
						fs.writeFileSync(filename, body, 'binary')
					else
						console.log(`Err with ${src}`)
				});
			}
		}
	});
}

function main(urlBase, index=0)
{
	let url = (index === 0) ? `${urlBase}` : `${urlBase}?p=${index}`
	request(url, (err, res, body) =>{
		if(!err){

			let $ = cheerio.load(body);
			let pageCount = $('.ptt td').length
			
			if(index >= pageCount)
			{
				return
			}
			else{
				// use japanese name, else use english
				let title = ($('#gd2 #gj')[0].children.length > 0) ? $('#gd2 #gj')[0].children[0].data : $('#gd2 #gn')[0].children[0].data
				
				let path = `${StoragePath}${title}/`
				if(!fs.existsSync(path)) 
					fs.mkdirSync(path)

				let pics = $('.gdtm a')

				console.log(`Found ${pics.length} Pics On ${title}[${index}]`)

				for(let i = 0; i < pics.length; ++i){
					let e = pics[i]
					if(typeof e.type != undefined && e.type == 'tag'){	
						getpic(e.attribs.href, path)
					}
				}
				
				main(urlBase, index + 1)	
			}
		}
	});
}