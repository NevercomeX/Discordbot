require("dotenv").config();
const mysql = require("mysql2");
const { Client, Intents } = require("discord.js");

const bot = new Client({ intents: [Intents.FLAGS.GUILDS] });

const { customStatus } = require("./config.json");

const env = process.env;
const APIKEY = env.API_KEY;
const APIURL = env.API_URL;
const DISCORDKEY = env.DISCORD_TOKEN_ID;
var timer;

function showLoading() {
	const frames = ["-", "\\", "|", "/"];
	let i = 0;
	return setInterval(() => {
		process.stdout.write("\r" + "Loading " + frames[i++]);
		i %= frames.length;
		process.stdout.write("\r");
	}, 100);
}

const pool = mysql.createPool({
	host: env.DB_HOST,
	user: env.DB_USER,
	password: env.DB_PASS,
	database: env.DB_NAME,
	waitForConnections: true,
	connectionLimit: 10,
	maxIdle: 10,
	idleTimeout: 60000,
	queueLimit: 0,
});

pool.getConnection((err, connection) => {
	if (err) throw err;
	console.log(`Database connected successfully as ID ${connection.threadId}`);
	createDatabaseAndTable();
	connection.release();
});

function createDatabaseAndTable() {
	pool.query("SHOW TABLES LIKE 'rates'", (err, results) => {
		if (err) throw err;
		if (results.length === 0) {
			pool.query(
				"CREATE TABLE rates (id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, rate DECIMAL(10, 2) NOT NULL, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)",
				(err) => {
					connection.release();
					if (err) throw err;
					console.log("Table created");
					getCoingecko();
				}
			);
		} else {
			console.log("Table Online");
			getCoingecko();
		}
	});
}

async function getOldRateFromDB() {
	const [rows] = await pool
		.promise()
		.execute("SELECT rate FROM rates ORDER BY id DESC LIMIT 1");
	if (rows.length === 0) {
		return null;
	}
	const oldRate = rows[0]?.rate;
	console.log(`Old rate ${oldRate} retrieved from the database!`);
	return oldRate;
}

async function insertOldRate(pool, oldRate) {
	const sql = `INSERT INTO rates (rate) SELECT ${oldRate} WHERE NOT EXISTS (SELECT * FROM rates)`;
	pool.query(sql, (err, result) => {
		if (err) throw err;
		console.log(`Old rate ${oldRate} inserted into the database!`);
	});
}

async function getConversionRate() {
	try {
		const response = await fetch(APIURL);

		if (!response.ok) {
			throw new Error("Failed to fetch conversion rate");
		}

		const data = await response.json();

		return parseFloat(data.info.rate);
	} catch (error) {
		console.error(`Error getting conversion rate: ${error.message}`);
		return null;
	}
}

async function updateRatePrice() {
	const rate = await getConversionRate();
	const oldRate = await getOldRateFromDB();
	clearInterval(showLoading);
	let newRate;
	const test = false;
	if (test) {
		console.log("Test mode enabled. Rate will not be updated.");
		const random = Math.random();
		newRate = parseFloat((4684.66 + random).toFixed(2));
	} else {
		newRate = parseFloat(rate).toFixed(2);
	}
	const diff = oldRate !== null ? newRate - oldRate : newRate;
	const diffThreshold = 0.5;
	const arrow =
		diff > diffThreshold
			? "( ↑ )"
			: diff < -diffThreshold
			? "( ↓ )"
			: diff > 0
			? "( ↗ )"
			: diff < 0
			? "( ↘ )"
			: "( = )";
	const activityName = `$ ${newRate} ${arrow} `;

	if (oldRate === null) {
		console.log("No old rate found. Creating new entry in the database...");
		await insertOldRate(newRate);
	} else {
		const sql = `UPDATE rates SET rate = ${newRate} ORDER BY id DESC LIMIT 1`;
		pool.query(sql, (err, result) => {
			if (err) throw err;

			const currentDate = new Date().toLocaleString();
			console.log(
				`[${currentDate}] - New rate ${activityName}updated in the database!`
			);
		});
	}
	return activityName;
}

function getCoingecko() {
	let guildMeCache = [];
	if (DISCORDKEY != "") {
		bot.on("ready", () => {
			bot.guilds.cache.each((guild) => guildMeCache.push(guild));

			console.log(`Logged in as ${bot.user.tag}!`);

			if (customStatus != "") {
				bot.user.setActivity(customStatus, { type: "WATCHING" });
			} else {
				bot.user.setActivity(`Discord.gg/Eternull`, { type: "WATCHING" });
			}

			setBot();
		});
	} else {
		console.log(
			"TIP: DISCORD_TOKEN_ID(.env) or APIid(config.json) missing. Press CTRL + C to exit!"
		);
	}

	async function setBot() {
		const rate = await updateRatePrice();
		for (let i = 0; i < guildMeCache.length; i++) {
			guildMeCache[i].me
				.setNickname(`${rate}`)
				.catch((error) =>
					console.log(
						"TIP: Bot has no roles or roles do not have the correct permissions. Press CTRL + C to exit!"
					)
				);
		}
	}

	// Call setBot() every 5 seconds
	setInterval(setBot, 50000);

	bot
		.login(DISCORDKEY)
		.catch((error) =>
			console.log("TIP: Missing or invalid DISCORD_TOKEN_ID. Check .env file")
		);
}
