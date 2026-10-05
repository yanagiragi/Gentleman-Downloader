const pMap = require('p-map')

const { DownloadGallery, RetryFailedDownloads } = require('../src/downloader')

async function RunArgument (argument) {
    if (argument === 'err.json') {
        return RetryFailedDownloads()
    }
    return DownloadGallery(argument)
}

if (require.main === module) {
    (async () => {
        // eslint-disable-next-line no-undef
        const urls = process.argv.slice(2)
        if (urls.length === 0) {
            console.log('Example: node cli.js $url [$url...]')
        }

        await pMap(urls, RunArgument, { concurrency: 5 })
    })()
}
