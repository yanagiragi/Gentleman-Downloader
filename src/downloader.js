const path = require('path')
const { Buffer } = require('buffer')
const AdmZip = require('adm-zip')
const fs = require('fs-extra')
const sanitize = require('sanitize-filename')

const { EH } = require('./eh')
const { NH } = require('./nh')
const { Wnacg } = require('./wnacg')
const { Ahri } = require('./ahri')
const { RequestAsync } = require('./util')

// Keep using the existing location so moving this implementation does not
// separate new downloads from the user's current library and retry state.
// eslint-disable-next-line no-undef
const StoragePath = path.join(__dirname, '..', 'bin', 'Storage')
const errFilesPath = path.join(StoragePath, 'err.json')
const outputIndexPath = path.join(StoragePath, '.download-index.json')

let errFiles = fs.existsSync(errFilesPath) ? JSON.parse(fs.readFileSync(errFilesPath)) : []
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

function GetRetryDirectory (download) {
    if (download.archive === true && typeof download.extractTo === 'string') {
        return path.resolve(download.extractTo)
    }
    if (typeof download.filename === 'string') {
        return path.resolve(path.dirname(download.filename))
    }
    return null
}

function AddMissingGalleryUrls (downloads) {
    const galleryUrlByDirectory = new Map(Object.entries(outputIndex).map(([galleryUrl, folderName]) => [
        path.resolve(StoragePath, folderName),
        galleryUrl
    ]))

    return downloads.map(download => {
        if (typeof download.galleryUrl === 'string') {
            return download
        }

        const galleryUrl = galleryUrlByDirectory.get(GetRetryDirectory(download))
        return galleryUrl == null ? download : { ...download, galleryUrl: galleryUrl }
    })
}

function CreateMissingArchives (pendingDownloads) {
    const pendingDirectories = new Set(pendingDownloads.map(GetRetryDirectory).filter(Boolean))
    const outputDirectories = fs.readdirSync(StoragePath, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => path.join(StoragePath, entry.name))

    for (const directory of outputDirectories) {
        if (pendingDirectories.has(path.resolve(directory)) || fs.existsSync(`${directory}.zip`)) {
            continue
        }

        try {
            CreateArchive(directory)
        }
        catch (err) {
            console.error(`Error When Archiving ${directory}: ${err}`)
        }
    }
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

function CreateCrawler (url) {
    if (url.includes('exhentai') || url.includes('e-hentai')) {
        return new EH(url)
    }
    if (url.includes('nhentai')) {
        return new NH(url)
    }
    if (url.includes('wnacg')) {
        return new Wnacg(url)
    }
    if (url.includes('ahri')) {
        return new Ahri(url)
    }
    throw new Error(`Unsupported gallery URL: ${url}`)
}

async function DownloadGallery (url) {
    try {
        fs.ensureDirSync(StoragePath)
        const crawler = CreateCrawler(url)

        // Setup titles, totalPageCount, MetaDatas
        await crawler.Setup()

        // Fetch Image Src
        await crawler.Run()

        const filepath = ReserveOutputPath(crawler.title, crawler.constructor.name, url)
        fs.ensureDirSync(filepath)
        let downloadFailed = false

        for (let i = 0; i < crawler.pics.length; ++i) {
            const imageUrl = crawler.pics[i].href
            const id = crawler.pics[i].id
            const isArchive = crawler.pics[i].archive === true
            const options = { uri: imageUrl, encoding: 'binary' }
            const extension = path.extname(new URL(imageUrl).pathname).slice(1) || 'bin'
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
                    throw new Error(`Invalid ${extension} response from ${imageUrl}`)
                }
                if (isArchive) {
                    ExtractArchive(body, filepath)
                    if (fs.existsSync(filename)) {
                        fs.removeSync(filename)
                    }
                    console.log(`Extract ${imageUrl} to ${filepath}`)
                }
                else {
                    console.log(`Save ${filename}`)
                    fs.writeFileSync(filename, body)
                }
            }
            catch (err) {
                console.error(`Error When Fetching ${imageUrl}`)
                downloadFailed = true
                errFiles.push({
                    galleryUrl: url,
                    url: imageUrl,
                    filename: filename,
                    archive: isArchive,
                    extractTo: filepath
                })
                fs.writeFileSync(errFilesPath, JSON.stringify(errFiles, null, 4))
            }
        }

        if (!downloadFailed) {
            CreateArchive(filepath)
        }

        return {
            url: url,
            success: !downloadFailed,
            directory: path.basename(filepath),
            archive: `${path.basename(filepath)}.zip`
        }
    }
    catch (err) {
        console.log(`Error On ${err}`)
        console.log('Abort.')
        return { url: url, success: false }
    }
}

async function RetryDownloads (data) {
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
    errFiles = errData
    fs.writeFileSync(errFilesPath, JSON.stringify(errData, null, 4))
    CreateMissingArchives(errData)
}

async function RetryFailedDownloads () {
    let data
    try {
        fs.ensureDirSync(StoragePath)
        data = AddMissingGalleryUrls(JSON.parse(fs.readFileSync(errFilesPath)))
    }
    catch (err) {
        console.log(`Error when parsing ${errFilesPath}, raw=<${err}>`)
        console.log('Abort.')
        return
    }
    return RetryDownloads(data)
}

module.exports = { DownloadGallery, RetryFailedDownloads }
