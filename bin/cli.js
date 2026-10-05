const path = require('path')
const { Buffer } = require('buffer')
const AdmZip = require('adm-zip')
const fs = require('fs-extra')
const pMap = require('p-map')
const sanitize = require('sanitize-filename')

const { EH, NH, Wnacg, Ahri } = require('..')
const { RequestAsync } = require('../src/util')

// eslint-disable-next-line no-undef
const StoragePath = path.join(__dirname, 'Storage')
// eslint-disable-next-line no-undef
const errFilesPath = path.join(__dirname, 'Storage', 'err.json')
// eslint-disable-next-line no-undef
const outputIndexPath = path.join(__dirname, 'Storage', '.download-index.json')
const errFiles = fs.existsSync(errFilesPath) ? JSON.parse(fs.readFileSync(errFilesPath)) : []
const outputIndex = fs.existsSync(outputIndexPath) ? JSON.parse(fs.readFileSync(outputIndexPath)) : {}
const claimedOutputPaths = new Map()

function ReserveOutputPath (title, source, downloadKey) {
    if (outputIndex[downloadKey] != null) {
        claimedOutputPaths.set(outputIndex[downloadKey], downloadKey)
        return path.join(StoragePath, outputIndex[downloadKey])
    }

    const baseName = sanitize(title, { replacement: '_' }) || source
    let folderName = baseName
    let suffix = 1

    const isClaimedByAnotherDownload = name =>
        (claimedOutputPaths.has(name) && claimedOutputPaths.get(name) !== downloadKey) ||
        Object.entries(outputIndex).some(([key, value]) => key !== downloadKey && value === name)

    while (isClaimedByAnotherDownload(folderName)) {
        folderName = `${baseName} (${source}${suffix === 1 ? '' : ` ${suffix}`})`
        suffix += 1
    }

    claimedOutputPaths.set(folderName, downloadKey)
    outputIndex[downloadKey] = folderName
    fs.writeFileSync(outputIndexPath, JSON.stringify(outputIndex, null, 4))
    return path.join(StoragePath, folderName)
}

function ExtractArchive (data, destination) {
    const zip = new AdmZip(data)
    zip.extractAllTo(destination, true)
}

function CreateArchive (directory) {
    const archivePath = `${directory}.zip`
    const zip = new AdmZip()
    zip.addLocalFolder(directory)
    zip.writeZip(archivePath)
    console.log(`Archive ${archivePath}`)
}

function IsValidDownload (filename, data = fs.readFileSync(filename)) {
    if (data.length === 0) {
        return false
    }

    const extension = path.extname(filename).toLowerCase()
    if (extension === '.webp') {
        return data.length >= 12 &&
            data.subarray(0, 4).toString('ascii') === 'RIFF' &&
            data.subarray(8, 12).toString('ascii') === 'WEBP' &&
            data.readUInt32LE(4) + 8 === data.length
    }
    if (extension === '.zip') {
        return data.subarray(0, 2).toString('ascii') === 'PK' &&
            data.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])) !== -1
    }
    if (extension === '.jpg' || extension === '.jpeg') {
        return data[0] === 0xff && data[1] === 0xd8 &&
            data[data.length - 2] === 0xff && data[data.length - 1] === 0xd9
    }
    if (extension === '.png') {
        return data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    }
    return true
}

if (require.main === module) {
    (async () => {

        fs.ensureDirSync(StoragePath)

        // eslint-disable-next-line no-undef
        const urls = process.argv.splice(2)
        if (urls.length === 0) {
            console.log('Example: node main.js $url [$url...]')
        }

        const mapper = async url => {
            return await Process(url)
        }

        await pMap(urls, mapper, { concurrency: 5 })
    })()
}

async function ProcessUrl (url) {
    let agent
    if (url.includes('exhentai')) {
        agent = new EH(url)
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

    try {
        // Setup titles, totalPageCount, MetaDatas
        await agent.Setup()

        // Fetch Image Src
        await agent.Run()

        const filepath = ReserveOutputPath(agent.title, agent.constructor.name, url)
        fs.ensureDirSync(filepath)
        let downloadFailed = false

        for (let i = 0; i < agent.pics.length; ++i) {
            const url = agent.pics[i].href
            const id = agent.pics[i].id
            const isArchive = agent.pics[i].archive === true
            const options = { uri: url, encoding: 'binary' }
            const extension = path.extname(new URL(url).pathname).slice(1) || 'bin'
            const safeID = sanitize(String(id), { replacement: '_' })
            const filename = path.join(filepath, `${safeID}.${extension}`)

            if (!isArchive && fs.existsSync(filename) && IsValidDownload(filename)) {
                console.log(`Skip ${filename}`)
                continue
            }
            if (!isArchive && fs.existsSync(filename)) {
                console.log(`Replace invalid file ${filename}`)
            }

            try {
                const body = await RequestAsync(options)
                if (!IsValidDownload(filename, body)) {
                    throw new Error(`Invalid ${extension} response from ${url}`)
                }
                if (isArchive) {
                    ExtractArchive(body, filepath)
                    if (fs.existsSync(filename)) {
                        fs.removeSync(filename)
                    }
                    console.log(`Extract ${url} to ${filepath}`)
                }
                else {
                    console.log(`Save ${filename}`)
                    fs.writeFileSync(filename, body)
                }
            }
            catch (err) {
                console.error(`Error When Fetching ${url}`)
                downloadFailed = true
                errFiles.push({ url: url, filename: filename, archive: isArchive, extractTo: filepath })
                fs.writeFileSync(errFilesPath, JSON.stringify(errFiles, null, 4))
            }
        }

        if (!downloadFailed) {
            CreateArchive(filepath)
        }
    }
    catch (err) {
        console.log(`Error On ${err}`)
        console.log('Abort.')
    }
}

async function ProcessErr (data) {
    const errData = []
    for (let i = 0; i < data.length; ++i) {
        const url = data[i].url
        const filename = data[i].filename
        const options = { uri: url, encoding: 'binary' }

        if (fs.existsSync(filename) && IsValidDownload(filename)) {
            console.log(`Skip ${filename}`)
            continue
        }

        try {
            const body = await RequestAsync(options)
            if (!IsValidDownload(filename, body)) {
                throw new Error(`Invalid response from ${url}`)
            }
            if (data[i].archive === true) {
                ExtractArchive(body, data[i].extractTo)
                CreateArchive(data[i].extractTo)
            }
            else {
                console.log(`Save ${filename}`)
                fs.writeFileSync(filename, body)
            }
        }
        catch (err) {
            console.error(`Error When Fetching ${url}`)
            errData.push(data[i])
        }
    }

    console.log(`Err = ${errData.length}`)
    fs.writeFileSync(errFilesPath, JSON.stringify(errData, null, 4))
}

async function Process (url) {
    if (url === 'err.json') {
        // process urls in err.json
        let data = []
        try {
            data = JSON.parse(fs.readFileSync(errFilesPath))
        }
        catch (err) {
            console.log(`Error when parsing ${errFilesPath}, raw=<${err}>`)
            console.log('Abort.')
            return
        }
        return ProcessErr(data)
    }
    else {
        return ProcessUrl(url)
    }
}
