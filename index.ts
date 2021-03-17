import dotenv = require("dotenv");
dotenv.config();

import express = require("express");
import compression = require("compression");
import bodyParser = require("body-parser");
import path = require("path");
import { doQuery, sql, getConnection } from "@fernap3/sql";
const getRandomValues = require("get-random-values");
import AWS = require("aws-sdk");


const sns = new AWS.SNS({
	region: "us-east-1",
	accessKeyId: process.env.AWS_ACCESS_KEY,
	secretAccessKey: process.env.AWS_SECRET_KEY,
});

function guid(): string
{
	return ((<any>[1e7])+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, (c: any) =>
		(c ^ getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
	)
}

const server = express();
express.static.mime.define({"application/manifest+json": ["webmanifest"]});

if(process.env.NODE_ENV === "production")
{
	server.use((req, res, next) =>
	{
		// Redirect HTTP to HTTPS
		if (req.header("x-forwarded-proto") !== "https")
			res.redirect(`https://${req.header("host")}${req.url}`);
		else
			next();
	})
}

server.disable("x-powered-by");
server.use(compression());
server.use(bodyParser.json());

const allLocations = [
	{ name: "Javits Center", id: "JAVITS", },
	{ name: "Jones Beach - Field 3", id: "JONES", },
	{ name: "State Fair Expo Center: NYS Fairgrounds", id: "FAIR", },
	{ name: "SUNY Albany", id: "ALBANY", },
	{ name: "Westchester County Center", id: "WESTCHESTER", },
	{ name: "SUNY Stony Brook", id: "STONYBROOK", },
	{ name: "SUNY Potsdam", id: "POTSDAM", },
	{ name: "Aqueduct Racetrack", id: "AQUEDUCT", },
	{ name: "Plattsburgh International Airport", id: "PLATTSBURGH", },
	{ name: "SUNY Binghamton", id: "BINGHAMTON", },
	{ name: "SUNY Polytechnic Institute", id: "POLYTECHNIC", },
	{ name: "University at Buffalo South Campus", id: "BUFFALO", },
	{ name: "Rochester Dome Arena", id: "ROCHESTER", },
];

server.get("/", (req, res) =>
{
	res.sendFile(path.join(__dirname, "index.html"));
});

server.post("/subscription", async (req, res) =>
{
	const { phone, locations, } = req.body;

	if (typeof phone !== "string" || phone.match(/^[0-9]{10}$/) == null)
	{
		res.status(400).send("Property 'phone' must be a 10-digit string of numbers");
		return;
	}

	if (locations == null || !locations.length || !locations.every((locationId: string) => allLocations.find(l => l.id === locationId)))
	{
		res.status(400).send(`Property 'locations' must be an array of string location IDs eg. ["JAVITS", "JONES", ...]. Possible location IDs are ${allLocations.map(l => l.id).join(", ")}`);
		return;
	}

	const { affectedRows } = await doQuery(sql`UPDATE Subscription SET Active = FALSE WHERE Phone=${phone}`);

	for (const locationId of locations)
		await doQuery(sql`INSERT INTO Subscription (Id, Phone, LocationId) VALUES(${guid()}, ${phone}, ${locationId})`);


	await sns.publish({
		PhoneNumber: `+1${phone}`,
		Message: `Signed up for vaccine alerts. Reply STOP to opt-out.`,
		MessageAttributes: {
			"AWS.SNS.SMS.SMSType": {
				DataType: "String",
				StringValue: "Transactional"
			}
		}
	}).promise();

	res.status(200).json({ isNew: affectedRows === 0 });
});

server.delete("/subscription", async (req, res) =>
{
	const { phone, } = req.body;

	if (typeof phone !== "string" || phone.match(/^[0-9]{10}$/) == null)
	{
		res.status(400).send("Property 'phone' must be a 10-digit string of numbers");
		return;
	}

	await doQuery(sql`UPDATE Subscription SET Active = FALSE WHERE Phone=${phone}`);
	res.status(200).send();
});


const port = process.env.PORT || 5000;
server.listen(port, () => console.log(`Listening on port ${port}`));


