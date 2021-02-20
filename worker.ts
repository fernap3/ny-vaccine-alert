import dotenv = require("dotenv");
dotenv.config();

import { launch } from "puppeteer";
import AWS = require("aws-sdk");
import { doQuery, sql, } from "@fernap3/sql";

const sns = new AWS.SNS({
	region: "us-east-1",
	accessKeyId: process.env.AWS_ACCESS_KEY,
	secretAccessKey: process.env.AWS_SECRET_KEY,
});

async function getAllLocations(): Promise<{id: string, displayName: string}[]>
{
	return await doQuery<{ id: string, displayName: string }>(sql`SELECT Id as id, DisplayName as displayName FROM Location`);
}

const url = "https://virtualqueue4.ny.gov";

async function scrapeAndAlert(allLocations: {id: string, displayName: string}[]): Promise<void>
{
	const locationNameIdMap = Object.fromEntries(allLocations.map(l => ([l.displayName, l.id])));
	const locationIdNameMap = Object.fromEntries(allLocations.map(l => ([l.id, l.displayName])));

	console.log(`Scraping ${url}`)
	const browser = await launch({ headless: true, ignoreHTTPSErrors: true });
	const page = await browser.newPage();

	await page.goto(url);

	// Wait for the table of locations to load
	await page.waitForFunction(() => { return [...document.querySelectorAll("#statePods_table td")].some(e => e.textContent.includes("Javits")) });

	const tableRows = await page.$$("#statePods_table > tbody > tr");
	const locationsOnPage = [] as { locationName: string, available: boolean }[];

	for (const tableRow of tableRows)
	{
		const placeName = await tableRow.evaluate(row => row.children[0].textContent);
		const appointmentsAvailableText = await tableRow.evaluate(row => row.children[2].textContent);
		
		locationsOnPage.push({ locationName: placeName.trim(), available: appointmentsAvailableText?.toLowerCase()?.trim() === "appointments available" })
	}

	for (const location of allLocations)
	{
		// For each known location, assert that it exists in the table, regardless of status (integrity check in case the web page changes)
		if (locationsOnPage.find(l => l.locationName === location.displayName) == null)
		{
			console.log(JSON.stringify(locationsOnPage))
			throw new Error(`Location with ID ${location.id} (${location.displayName}) was not found on https://virtualqueue4.ny.gov. Did the web page change?`);
		}
	}

	const locationsIdsWithAvailability = locationsOnPage
		.filter(l => l.available)
		.map(l => l.locationName)
		.map(locationName => locationNameIdMap[locationName]);


	const subscriptionsToAlert = await doQuery<{ id: string, phone: string, locationId: string }>(sql`
		SELECT Id as id, Phone as phone, LocationId as locationId
		FROM Subscription
		WHERE LocationId IN (${locationsIdsWithAvailability}) AND NOT Alerted
	`);

	for (const subscription of subscriptionsToAlert)
	{
		const locationName = locationIdNameMap[subscription.locationId];
		console.log(`Alerting ${subscription.phone} on availability for ${locationName}`);
		await sns.publish({
			PhoneNumber: `+1${subscription.phone}`,
			Message: `Vaccinne appt. availabilty detected for ${locationName}. Check the NY state website.`,
			MessageAttributes: {
				"AWS.SNS.SMS.SMSType": {
					DataType: "String",
					StringValue: "Transactional"
				}
			}
		}).promise();
	}

	if (subscriptionsToAlert.length > 0)
		await doQuery<void>(sql`UPDATE Subscription SET Alerted=1 WHERE Id IN (${subscriptionsToAlert.map(s => s.id)})`);

	await browser.close();

	setTimeout(() => scrapeAndAlert(allLocations), 30000);
}

(async () => {
	scrapeAndAlert([...(await getAllLocations()).map(l => ({ id: l.id, displayName: l.displayName }))]);
})();
