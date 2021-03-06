const puppeteer = require("puppeteer-extra");
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const chalk = require("chalk")
const schedule = require("node-schedule")

puppeteer.use(StealthPlugin());

const { randomUUID } = require('crypto')
const { sendMail } = require("./mail")

const URL =
    "https://ebilet.tcddtasimacilik.gov.tr/view/eybis/tnmGenel/tcddWebContent.jsf";

const allParanthesesRgx = /\([^()]+\)/g
const lastParanthesesRgx = /.*\(([^)]+)\)/
const log = console.log

var wagons = []
var foundTickets = []

//function returns 1 when it find ticket 
//otherwise return 0
async function fetchTCDD(from, to, date, amount) {

    const browser = await puppeteer.launch({
        headless: true,
        defaultViewport: null,
        'args': [
            "--incognito",
            '--no-sandbox',
            '--disable-setuid-sandbox',
        ]
    });
    const page = await browser.newPage();
    await page.setRequestInterception(true);

    //if the page makes a  request to a resource type of image or stylesheet then abort that request
    page.on('request', req => {
        if (req.resourceType() === 'image' || req.resourceType() === 'stylesheet')
            req.abort();
        else
            req.continue();
    });


    await page.goto(URL, { waitUntil: 'domcontentloaded' });

    // set "From"
    await page.type("#nereden", from);
    await page.waitForTimeout(400);
    await page.click("body > ul:nth-child(5) > li > a");
    await page.waitForTimeout(250);

    // set "To"
    await page.type("#nereye", to);
    await page.waitForTimeout(400);
    await page.click("body > ul:nth-child(6) > li > a");
    await page.waitForTimeout(250);

    // set "Date"
    await page.$eval("#trCalGid_input", (el) => (el.value = ""));
    await page.waitForTimeout(250);
    await page.type("#trCalGid_input", date);

    await page.waitForTimeout(750);

    //Click search button
    await page.click("#btnSeferSorgula");
    await page.waitForNavigation();


    try {
        await page.waitForTimeout(600);
        wagons = []
        foundTickets = []
        let index = 1;

        while (true) {
            let wagon = await page.$x(`/html/body/div[3]/div[2]/div/div/div/div/form/div[1]/div/div[1]/div/div/div/div[1]/div/div/div/table/tbody/tr[${index}]/td[5]/div/label`)
            let hour = await page.$x(`/html/body/div[3]/div[2]/div/div/div/div/form/div[1]/div/div[1]/div/div/div/div[1]/div/div/div/table/tbody/tr[${index}]/td[1]/span`)

            if (!wagon) {
                break;
            } else {
                let wagonText = await page.evaluate(el => el.textContent, wagon[0]);
                let hourText = await page.evaluate(el => el.textContent, hour[0]);
                // console.log(hourText)
                // console.log(wagonText)

                // Dont get "1. mevki" train ticket because it takes 2 times longer.
                if (String(wagonText).match(allParanthesesRgx)[0].toLowerCase() !== "(1. mevki)") {
                    wagons.push({ wagonText, hourText })
                }
                // log(String(result).match(allParanthesesRgx)[0].toLowerCase(), result)
                // log(possibleWagons)
                index++
            }
        }
    }
    catch {
        //Get last parantheses from wagon info which contains possible seats.
        wagons = wagons.map((wagon) => ({
            ...wagon, wagonText: ((String(wagon.wagonText).includes("(") && String(wagon.wagonText).includes(")")) ? (String(wagon.wagonText).match(lastParanthesesRgx)[1]) : "0")
        }))

        // //0 , 1 and 2 means there is no ticket for us. 

        wagons.forEach((wagon, _) => {
            wagon.wagonText -= 2
            wagon.wagonText = wagon.wagonText < 0 ? 0 : wagon.wagonText
            // console.log(wagon.wagonText, "--", amount)
            if (wagon.wagonText >= amount) {
                foundTickets.push(wagon)
            }
        })
        // console.log(foundTickets)
        // ({ wagonText }) => wagonText !== "2" && wagonText !== "1" && wagonText !== "0")
        // 
    }

    // await page.waitForTimeout(250);

    if (foundTickets.length > 0) {
        log(chalk.red("******"));

        foundTickets.forEach(({ hourText }, _) => {
            log(chalk.green(`${hourText} saatinde Bilet Bulundu `));
        })

        log(chalk.red("******* "))

        await browser.close();
        return foundTickets;
    } else {
        log(chalk.green(" Yer bulamad??m Bir daha deneyece??im "))
    }


    if (String(page.url()).split("?")[1] == "expired=true") {
        log(chalk.red("****\nexpired tekrar deneniyor\n****\n"))
        await browser.close();
        return 0;
    }

    await browser.close();
    return 0;

}

const createJob = (from, to, date, toMail, activeUsers, amount) => {
    const id = randomUUID()

    schedule.scheduleJob(id, "*/30 * * * * *", function () {
        log(chalk.cyan("Trenbileti aranan tarih => " + chalk.cyan.bold(date)))
        log(chalk.blue.bold("saat : " + chalk.bold(new Date().toLocaleString().split(" ")[1]) + ". kontrol ediliyor.\n"))

        fetchTCDD(from, to, date, amount)
            .then((foundTickets) => {
                if (foundTickets?.length > 0) {
                    let mailText = "";

                    foundTickets.forEach(({ hourText }, _) => {
                        mailText += `${hourText} \n`
                    })
                    var mail = {
                        subject: "B??LET BULUNDU",
                        text: "\n\n" + date + ` tarihinde ${amount} adet bilet bulunmu??tur.\nBiletlerin saatleri : \n${mailText}\n Tcdd bilet sat??n alma : "ebilet.tcddtasimacilik.gov.tr/view/eybis/tnmGenel/tcddWebContent.jsf"`
                    }
                    sendMail(toMail, mail)
                    try {
                        schedule.scheduledJobs[id].cancel()
                        activeUsers.emails.splice(activeUsers.emails.indexOf(toMail), 1)
                        console.log("active emails" + activeUsers.emails)
                        console.log("1 i??lem sonland??r??ld??. \nKalan i??lem say??s?? " + activeUsers.emails.length)
                    } catch {
                    }
                }
            })
    });

}

const finishAllJobs = (activeUsers) => {
    activeUsers.emails = []
    console.log("B??t??n i??lemler sonland??r??l??yor : \n " + "\n\nBa??ar??yla sonland??r??ld?? ")
    schedule.gracefulShutdown()
}

module.exports = { createJob, finishAllJobs }

