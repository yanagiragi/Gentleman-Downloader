var request = require('request');
var fs = require('fs');
var cheerio = require('cheerio');

var urls = ['http://g.e-hentai.org/g/472987/704f8a429a/','http://g.e-hentai.org/g/472987/704f8a429a/?p=1','http://g.e-hentai.org/g/472987/704f8a429a/?p=2','http://g.e-hentai.org/g/472987/704f8a429a/?p=3'];

for(var url in urls){
	request(urls[url], (err, res , body) =>{
		if(!err){
			var $ = cheerio.load(body);
			for(var b in $('.gdtm a')){				
				var a = $('.gdtm a')[b];				
				if(typeof a.type != undefined && a.type == 'tag')
					getpic(a.attribs.href);
			}
		}
	});
}

function getpic(url){
	request(url, (err, res , body) =>{
		if(!err){
			//console.log(body);
			var $ = cheerio.load(body);
			var src = $('#i3 img')[0].attribs.src;
			var filename = src.substr(src.lastIndexOf('/')+1);
			request.get( {url : src, encoding : 'binary'}, (err, res, body) => {
				if(!err){
					fs.writeFile(filename, body, 'binary');
				}
				else{
					console.log('err with ' + src);
				}
			});
			//console.log(filename);
		}
	});
}