const express = require('express')
const cors = require('cors')
const fs = require('fs')
const path = require('path')
const bodyParser = require('body-parser')
const cookieParser = require('cookie-parser')
const helmet = require('helmet');
const { EH, NH, Wnacg, Ahri } = require('..')

const app = express()

const PASSWORD = process.env.GDW_PASSWORD || 'pass'
const TOKEN = Date.now().toString()

app.use(helmet());
// app.use(cors())
app.use(cookieParser(TOKEN))
app.use(bodyParser.urlencoded({ extended: false }))
app.use(bodyParser.json())
app.use(express.static(path.join(__dirname, 'assets')));
app.listen(3004)

app.use(function (req, res, next) {
	let ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress
	if (ip && req.path) {
		console.log(`Request from ${ip}, path = ${req.path}`)
	} else {
		console.log(`Request from ????, path = ${req.path}`)
	}

	const whiteList = ['/login', '/favicon.ico']
	if(whiteList.includes(req.path) || (req.signedCookies && req.signedCookies.auth === TOKEN)) {
		next()
	}
	else {
        res.redirect('/login')
	}
})

app.get('/', (req, res) => {
	let data = path.join(__dirname, 'index.html')
	res.sendFile(data)
})

app.get('/login', (req, res) => {
	if(req.signedCookies && req.signedCookies.auth === TOKEN) {
		res.redirect('/')
	}
	else {
		let data = path.join(__dirname, 'login.html')
		res.sendFile(data)
	}
})

app.post('/login', (req, res) => {
	if(req.body.password === PASSWORD){
		res.cookie('auth', TOKEN, { signed: true, maxAge: 1000 * 60 * 60 * 24 * 365 })
		res.redirect('/')
	}
	else {
		res.redirect('/login')
	}
})

app.get('/search', async (req, res) => {
    const keyword = req.query.param
    const slice = 20
    const EHResults = await EH.Search(keyword, slice)
    const NHResults = await NH.Search(keyword, slice)
    const WnacgResults = await Wnacg.Search(keyword, slice)
    const AhriResults = await Ahri.Search(keyword, slice)
    const results = {EH: EHResults, NH: NHResults, Wnacg: WnacgResults, Ahri: AhriResults }

    res.send(results)
})
