const pMap = require('p-map')

const { EH, NH, Wnacg, Ahri } = require('..')

if (require.main === module) {
    (async () => {
        // eslint-disable-next-line no-undef
        const urls = process.argv.splice(2)
        if (urls.length === 0) {
            console.log('Example: node main.js $keyword [$keyword...]')
        }

        const mapper = async url => {
            return await Process(url)
        }

        await pMap(urls, mapper, { concurrency: 5 })
    })()
}

async function Process (keyword) {
    const EHResults = await EH.Search(keyword)
    const NHResults = await NH.Search(keyword)
    const WnacgResults = await Wnacg.Search(keyword)
    const AhriResults = [] // await Ahri.Search(keyword) // not work due to obfuscation for now

    const results = { EH: EHResults, NH: NHResults, Wnacg: WnacgResults, Ahri: AhriResults }

    console.log(`keyword = ${keyword}`)
    console.log(JSON.stringify(results, null, 4))
    console.log('')
}