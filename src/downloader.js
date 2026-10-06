const path = require('path')
const { Buffer } = require('buffer')
const AdmZip = require('adm-zip')
const fs = require('fs-extra')
const sanitize = require('sanitize-filename')

const { EH } = require('./eh')
const { EX } = require('./ex')
const { NH } = require('./nh')
const { Wnacg } = require('./wnacg')
const { Ahri } = require('./ahri')
const { RequestAsync } = require('./util')

// Keep using the existing location so moving this implementation does not
// separate new downloads from the user's current library and retry state.
// eslint-disable-next-line no-undef
const StoragePath = path.join(__dirname, '..', 'Storage')
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

async function CreateArchive (directory) {
    const archivePath = `${directory}.zip`
    const zip = new AdmZip()
    zip.addLocalFolder(directory)
    await zip.writeZipPromise(archivePath)
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

function AddMissingRetryDetails (downloads) {
    return downloads.map(download => {
        const directory = GetRetryDirectory(download)
        const galleryTitle = typeof download.galleryTitle === 'string' && download.galleryTitle.trim() !== ''
            ? download.galleryTitle
            : directory == null ? 'Unknown gallery' : path.basename(directory)
        const page = download.page != null
            ? String(download.page)
            : download.archive === true
                ? 'archive'
                : typeof download.filename === 'string'
                    ? path.parse(download.filename).name
                    : 'unknown'

        return { ...download, galleryTitle: galleryTitle, page: page }
    })
}

async function CreateMissingArchives (pendingDownloads, onArchive) {
    const pendingDirectories = new Set(pendingDownloads.map(GetRetryDirectory).filter(Boolean))
    const outputDirectories = fs.readdirSync(StoragePath, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => path.join(StoragePath, entry.name))

    for (const directory of outputDirectories) {
        if (pendingDirectories.has(path.resolve(directory)) || fs.existsSync(`${directory}.zip`)) {
            continue
        }

        try {
            if (typeof onArchive === 'function') {
                onArchive(path.basename(directory))
            }
            await CreateArchive(directory)
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
    if (url.includes('exhentai')) {
        return new EX(url)
    }
    if (url.includes('e-hentai')) {
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

function ReportProgress (onProgress, progress) {
    if (typeof onProgress !== 'function') {
        return
    }

    try {
        onProgress(progress)
    }
    catch (err) {
        console.error(`Error When Reporting Download Progress: ${err}`)
    }
}

async function RefreshRetryUrls (downloads, onProgress) {
    const downloadsByGallery = new Map()

    for (const download of downloads) {
        if (typeof download.galleryUrl !== 'string') {
            continue
        }
        if (fs.existsSync(download.filename) && IsValidDownload(download.filename)) {
            continue
        }

        const galleryDownloads = downloadsByGallery.get(download.galleryUrl) || []
        galleryDownloads.push(download)
        downloadsByGallery.set(download.galleryUrl, galleryDownloads)
    }

    for (const [galleryUrl, galleryDownloads] of downloadsByGallery) {
        const currentGallery = galleryDownloads[0].galleryTitle
        ReportProgress(onProgress, {
            status: 'refreshing',
            completed: 0,
            total: downloads.length,
            failed: 0,
            currentGallery: currentGallery,
            currentPage: null
        })

        try {
            const crawler = CreateCrawler(galleryUrl)
            await crawler.Setup()
            await crawler.Run()

            for (const download of galleryDownloads) {
                const freshPic = download.archive === true
                    ? crawler.pics.find(pic => pic.archive === true)
                    : crawler.pics.find(pic => String(pic.id) === String(download.page))

                if (freshPic == null) {
                    console.error(`Unable to refresh page ${download.page} from ${galleryUrl}`)
                    continue
                }

                download.url = freshPic.href
                download.galleryTitle = crawler.title || download.galleryTitle
            }
        }
        catch (err) {
            // Keep the previous image URLs as a fallback when the gallery itself
            // is temporarily unavailable. The normal retry loop will test them.
            console.error(`Unable to refresh image URLs from ${galleryUrl}: ${err}`)
        }
    }

    return downloads
}

async function DownloadGallery (url, progressOptions = {}) {
    const onProgress = progressOptions != null && typeof progressOptions === 'object'
        ? progressOptions.onProgress
        : null

    try {
        fs.ensureDirSync(StoragePath)
        ReportProgress(onProgress, { status: 'preparing', completed: 0, total: 0, failed: 0 })
        const crawler = CreateCrawler(url)

        // Setup titles, totalPageCount, MetaDatas
        await crawler.Setup()
        ReportProgress(onProgress, {
            status: 'locating',
            title: crawler.title,
            completed: 0,
            total: 0,
            failed: 0
        })

        // Fetch Image Src
        await crawler.Run()

        const filepath = ReserveOutputPath(crawler.title, crawler.constructor.name, url)
        fs.ensureDirSync(filepath)
        let downloadFailed = false
        let failedCount = 0

        ReportProgress(onProgress, {
            status: 'downloading',
            title: crawler.title,
            completed: 0,
            total: crawler.pics.length,
            failed: 0
        })

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
                ReportProgress(onProgress, {
                    status: 'downloading',
                    completed: i + 1,
                    total: crawler.pics.length,
                    failed: failedCount
                })
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
                failedCount += 1
                errFiles.push({
                    galleryUrl: url,
                    galleryTitle: crawler.title,
                    page: isArchive ? 'archive' : String(id),
                    url: imageUrl,
                    filename: filename,
                    archive: isArchive,
                    extractTo: filepath
                })
                fs.writeFileSync(errFilesPath, JSON.stringify(errFiles, null, 4))
            }

            ReportProgress(onProgress, {
                status: 'downloading',
                completed: i + 1,
                total: crawler.pics.length,
                failed: failedCount
            })
        }

        if (!downloadFailed) {
            ReportProgress(onProgress, {
                status: 'archiving',
                completed: crawler.pics.length,
                total: crawler.pics.length,
                failed: 0
            })
            await CreateArchive(filepath)
        }

        const result = {
            url: url,
            success: !downloadFailed,
            directory: path.basename(filepath),
            archive: `${path.basename(filepath)}.zip`
        }
        ReportProgress(onProgress, {
            status: result.success ? 'completed' : 'failed',
            title: crawler.title,
            completed: crawler.pics.length,
            total: crawler.pics.length,
            failed: failedCount,
            directory: result.directory,
            archive: result.archive
        })
        return result
    }
    catch (err) {
        console.log(`Error On ${err}`)
        console.log('Abort.')
        ReportProgress(onProgress, { status: 'failed', error: String(err) })
        return { url: url, success: false }
    }
}

async function RetryDownloads (data, onProgress) {
    const errData = []
    let failedCount = 0

    data = await RefreshRetryUrls(data, onProgress)
    errFiles = data
    fs.writeFileSync(errFilesPath, JSON.stringify(data, null, 4))

    ReportProgress(onProgress, {
        status: 'retrying',
        completed: 0,
        total: data.length,
        failed: 0
    })

    for (let i = 0; i < data.length; ++i) {
        const url = data[i].url
        const filename = data[i].filename
        const options = { uri: url, encoding: 'binary' }
        const currentGallery = data[i].galleryTitle
        const currentPage = data[i].page

        ReportProgress(onProgress, {
            status: 'retrying',
            completed: i,
            total: data.length,
            failed: failedCount,
            currentGallery: currentGallery,
            currentPage: currentPage
        })

        if (fs.existsSync(filename) && IsValidDownload(filename)) {
            console.log(`Skip ${filename}`)
            ReportProgress(onProgress, {
                status: 'retrying',
                completed: i + 1,
                total: data.length,
                failed: failedCount,
                currentGallery: currentGallery,
                currentPage: currentPage
            })
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
            failedCount += 1
        }

        ReportProgress(onProgress, {
            status: 'retrying',
            completed: i + 1,
            total: data.length,
            failed: failedCount,
            currentGallery: currentGallery,
            currentPage: currentPage
        })
    }

    console.log(`Err = ${errData.length}`)
    errFiles = errData
    fs.writeFileSync(errFilesPath, JSON.stringify(errData, null, 4))
    ReportProgress(onProgress, {
        status: 'archiving',
        completed: data.length,
        total: data.length,
        failed: errData.length,
        currentGallery: null,
        currentPage: null
    })
    await CreateMissingArchives(errData, galleryTitle => {
        ReportProgress(onProgress, {
            status: 'archiving',
            completed: data.length,
            total: data.length,
            failed: errData.length,
            currentGallery: galleryTitle,
            currentPage: null
        })
    })

    const result = {
        success: errData.length === 0,
        total: data.length,
        succeeded: data.length - errData.length,
        failed: errData.length
    }
    ReportProgress(onProgress, {
        status: result.success ? 'completed' : 'failed',
        completed: data.length,
        total: data.length,
        failed: result.failed,
        currentGallery: null,
        currentPage: null
    })
    return result
}

async function RetryFailedDownloads (progressOptions = {}) {
    const onProgress = progressOptions != null && typeof progressOptions === 'object'
        ? progressOptions.onProgress
        : null
    let data
    ReportProgress(onProgress, { status: 'preparing', completed: 0, total: 0, failed: 0 })
    try {
        fs.ensureDirSync(StoragePath)
        data = AddMissingRetryDetails(AddMissingGalleryUrls(JSON.parse(fs.readFileSync(errFilesPath))))
    }
    catch (err) {
        console.log(`Error when parsing ${errFilesPath}, raw=<${err}>`)
        console.log('Abort.')
        const publicError = 'Unable to read retry data'
        ReportProgress(onProgress, { status: 'failed', error: publicError })
        return { success: false, total: 0, succeeded: 0, failed: 0, error: publicError }
    }
    return RetryDownloads(data, onProgress)
}

module.exports = { DownloadGallery, RetryFailedDownloads }
