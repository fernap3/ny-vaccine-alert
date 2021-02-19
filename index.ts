import { launch } from "puppeteer";
import AWS = require("aws-sdk");

const sns = new AWS.SNS({ region: "us-east-1" });

const locationNames = [
	"Javits Center",
	"Jones Beach - Field 3",
	"State Fair Expo Center: NYS Fairgrounds",
	"SUNY Albany",
	"Westchester County Center",
	"SUNY Stony Brook University Innovation and Discovery Center",
	"SUNY Potsdam Field House",
	"Aqueduct Racetrack - Racing Hall",
	"Plattsburgh International Airport -Connecticut Building",
	"SUNY Binghamton",
	"SUNY Polytechnic Institute - Wildcat Field House",
	"University at Buffalo South Campus - Harriman Hall",
	"Rochester Dome Arena",
];

(async () =>
{
	const browser = await launch({ headless: false, ignoreHTTPSErrors: true });
	const page = await browser.newPage();

	await page.goto("https://virtualqueue4.ny.gov");

	// Wait for the table of locations to load
	await page.waitForFunction(() => { return [...document.querySelectorAll("#statePods_table td")].some(e => e.textContent.includes("Javits")) });

	const tableRows = await page.$$("#statePods_table > tbody > tr");
	
	const locations = [] as { location: string, available: boolean }[];

	for (const tableRow of tableRows)
	{
		const placeName = await tableRow.evaluate(row => row.children[0].textContent);
		const appointmentsAvailableText = await tableRow.evaluate(row => row.children[2].textContent);
		
		locations.push({ location: placeName, available: appointmentsAvailableText?.toLowerCase()?.trim() === "appointments available" })
	}

	const locationsWithAvailability = locations.filter(l => l.available);

	if (locationsWithAvailability.find(l => l.location === "SUNY Binghamton"))
	{
		console.log("alerting")
		await sns.publish({
			TopicArn: "arn:aws:sns:us-east-1:335841285045:vaccine",
			Message: "Hey peter",
		}).promise();
	}

	await browser.close();
})();

