var tab_status = {}
var notification_button_click_state = {}

const url_patterns = [".ipfs.localhost", ".ipns.localhost"]

request_timeout = 3000;

const sleep = (milliseconds) => {
	return new Promise(resolve => setTimeout(resolve, milliseconds))
}

function has_keys(keys, dict) {
	for (let i = 0; i < keys.length; i++) {
		if (!(keys[i] in dict)) {
			return false;
		}
	}
	return true;
}

if (typeof (window) === 'undefined') {
	// handle console run for testing
	var XMLHttpRequest = require("xmlhttprequest").XMLHttpRequest;;
	var openpgp = require('openpgp');
	var fetch = require('node-fetch');
	verify('http://bafybeid4yuxsupkihtng3um6epzdpccmvk5fot53azgqcexz3pa3evrvue.ipfs.localhost:8080/');
} else {
	// handle browser load
	chrome.runtime.onInstalled.addListener(function () {
		// chrome.storage.sync.set({ color: '#3aa757' }, function () {
		console.log("Installed Islands.");
		// });
		/*chrome.declarativeContent.onPageChanged.removeRules(undefined, function () {
			chrome.declarativeContent.onPageChanged.addRules([{
				conditions: [new chrome.declarativeContent.PageStateMatcher({
					pageUrl: { hostContains: 'localhost' },
				})
				],
				actions: [
					new chrome.declarativeContent.ShowPageAction(),
				]
			}]);
		});*/
	});

	// update button click state tracker
	chrome.notifications.onClosed.addListener(function (notificationId) {
		console.log("[" + notificationId + "] closed");
		if (!(notificationId in notification_button_click_state)
			|| (notification_button_click_state[notificationId] === undefined)
			|| (notification_button_click_state[notificationId] === -1)) {
			console.log("[" + notificationId + "] set to default value");
			notification_button_click_state[notificationId] = -1;
		}
	});
	chrome.notifications.onClicked.addListener(function (notificationId) {
		console.log("[" + notificationId + "] clicked");
		notification_button_click_state[notificationId] = -1;
	});
	chrome.notifications.onButtonClicked.addListener(function (notificationId, buttonIndex) {
		console.log("[" + notificationId + "]", "button", buttonIndex, "pressed");
		notification_button_click_state[notificationId] = buttonIndex;
	});

	// launch verification process when tab content is loaded or reloaded
	chrome.tabs.onUpdated.addListener(function (tab_id, info) {
		if (info.status === 'complete') {
			console.log("Finished loading tab", tab_id);
			tab_status[tab_id] = "loaded";

			chrome.tabs.query({ active: true, lastFocusedWindow: true }, tabs => {
				tabs.forEach(async function (tab, index, array) {
					if (tab.id == tab_id) {
						url = tab.url;
						for (let i = 0; i < url_patterns.length; i++) {
							if (url.indexOf(url_patterns[i]) >= 0) {
								console.log("Verifying", tab.url);
								tab_status[tab_id] = await verify(tab.url);
								if (tab_status[tab_id] !== 'verified') {
									chrome.notifications.create(options = {
										type: "basic",
										title: "Verification Result",
										message: tab_status[tab_id],
										iconUrl: "images/get_started16.png",
									});
								}
							}
						}
					}
				})
			});
		}
	});

	/*chrome.tabs.onActivated.addListener(activeTab => {
		console.log("Activated tab", activeTab.tabId);
		for (let i = 0; i < url_patterns.length; i++) {
			url = activeTab.url;
			console.log("Checking url", url);
			if (typeof (url) !== 'undefined' && url.indexOf(url_patterns[i]) >= 0) {
				console.log("Enabling...");
				chrome.pageAction.show(activeTab.tabId);
			} else {
				console.log("Disabling...");
				chrome.pageAction.hide(activeTab.tabId);
			}
		}
	});*/
}

async function get_real_url(url) {
	if (url.substr(-1) === '/') {
		console.log(url, "does not contain path information, checking for real path...")
		// ref: https://stackoverflow.com/a/10926978/577298
		real_url_dict = {}
		path_names = ['index', 'index.htm', 'index.html']

		let real_url = "";
		for (let index = 0; index < path_names.length; index++) {
			path = path_names[index];
			const potential = url + path;
			let response = await fetch(potential);
			if (response.ok) {
				real_url = potential;
				break;
			}
		}

		if (real_url === "") {
			console.log("No valid real URL found.")
			return null;
		}

		url = real_url;
		console.log("Using real URL", url);
	}

	return url;
}

async function get_signature(url) {
	let signature = null;

	// ASCII-armored signatures
	let sig_url = url + ".asc"
	console.log("Checking for", sig_url);
	let response = await fetch(sig_url);
	if (response.ok) {
		text = await response.text();
		try {
			signature = await openpgp.signature.readArmored(text);
			return signature
		} catch (e) {
			console.log("Failed to parse signature file", sig_url);
			// swallow error; we may have a valid binary sig
		}
	}

	// Binary signatures
	sig_url = url + ".sig"
	console.log("Checking for", sig_url);
	response = await fetch(sig_url);
	if (response.ok) {
		data = new Uint8Array(await response.arrayBuffer());
		try {
			signature = await openpgp.signature.read(data);
			return signature
		} catch (e) {
			console.log("Failed to parse signature file", sig_url);
			// swallow error so UI can report error cleanly
		}
	}

	return signature;
}

// ref: https://stackoverflow.com/a/54261558/577298
// ref: https://stackoverflow.com/a/2274327/577298
const read_storage = key =>
	new Promise((resolve, reject) =>
		chrome.storage.sync.get([key], result =>
			chrome.runtime.lastError
				? reject(Error(chrome.runtime.lastError.message))
				: resolve(result)
		)
	)

const write_storage = (key, value) =>
	new Promise((resolve, reject) =>
		chrome.storage.sync.set({ [key]: value }, () =>
			chrome.runtime.lastError
				? reject(Error(chrome.runtime.lastError.message))
				: resolve()
		)
	)
async function get_pubkey(url) {
	let pubkey = null;

	let pubkey_text = null;

	// check for trusted pubkey
	const hostname = new URL(url).hostname;
	console.log("Checking for trusted pubkey for", hostname);

	pubkey_text_result = await read_storage(hostname);
	if (Object.entries(pubkey_text_result).length !== 0) {
		pubkey_text = pubkey_text_result[hostname]
		console.log(pubkey_text);
		pubkey = await openpgp.key.readArmored(pubkey_text);
		console.log(pubkey);
		return pubkey;
	} else {
		let temp_url = new URL(url);
		temp_url.pathname = "pubkey.asc";
		console.log("Checking for", temp_url.toString());

		const response = await fetch(temp_url);
		var potential_pubkey = null;
		if (response.ok) {
			pubkey_text = await response.text();
			potential_pubkey = await openpgp.key.readArmored(pubkey_text);
		}

		// prompt user for pubkey trust
		const id = "trust-key-prompt";
		notification_button_click_state[id] = -1;
		chrome.notifications.create(notificationId = id, options = {
			type: "basic",
			requireInteraction: true,
			title: "Trust Public Key?",
			message: "Host: " + hostname + "\nKey Fingerprint: " + potential_pubkey.keys[0].getFingerprint(),
			iconUrl: "images/get_started16.png",
			buttons: [
				{ title: "Yes" },
				{ title: "No" },
			],
		});

		const sleep_interval = 250;
		let count = 0;
		while (!(id in notification_button_click_state)
			|| (notification_button_click_state[id] === undefined)
			|| (notification_button_click_state[id] === -1)) {
			console.log("Waiting for pubkey trust decision...");
			await sleep(sleep_interval);
			count += sleep_interval;
		}

		if (notification_button_click_state[id] == 0) {
			pubkey = potential_pubkey;
			await write_storage(hostname, pubkey_text);
			console.log("Trusted key", pubkey.keys[0].getFingerprint(), "for host", hostname);
			const tmp = await read_storage(hostname);
			console.log("Read result", tmp);
		} else {
			console.log("User doesn't trust pubkey.");
		}
	}

	return pubkey;
}

async function get_content(url) {
	let message = null;

	const response = await fetch(url);
	if (!response.ok) {
		console.log("Failed to retrieve", url, "for verification");
		return null;
	}

	// use bytes because not all content is text content
	const data = new Uint8Array(await response.arrayBuffer());
	message = openpgp.message.fromBinary(data);

	return message;
}

async function verify(url) {
	// chrome.storage.sync.clear();
	url = await get_real_url(url);
	console.log("real url:", url)
	if (url == null) {
		console.log("Failed to get real URL.");
		return 'real-url-fail';
	}

	const signature = await get_signature(url);
	console.log("signature:", signature)
	if (signature == null) {
		console.log("Failed to obtain signature file.");
		return 'sig-fail';
	}

	const pubkey = await get_pubkey(url);
	console.log("pubkey:", pubkey)
	if (pubkey == null || typeof (pubkey.err) !== 'undefined') {
		console.log("Failed to obtain public key.");
		return 'pubkey-fail';
	}

	const message = await get_content(url);
	console.log("message:", message)
	if (openpgp.message == null) {
		console.log("Failed to obtain content.");
		return 'content-fail';
	}

	const verified = await openpgp.verify({
		message: message,
		signature: signature,
		publicKeys: pubkey.keys
	})

	console.log("verified:", verified)
	const { valid } = verified.signatures[0];
	if (valid) {
		console.log('Verified signature by key id ' + verified.signatures[0].keyid.toHex());
		return 'verified';
	} else {
		console.log('Failed to verify', url);
		console.log(verified);
		return 'verify-fail';
	}
}
