var tabStatus = {}
var notificationButtonClickState = {}

const urlPatterns = [".ipfs.localhost", ".ipns.localhost"]

const sleep = (milliseconds) => {
	return new Promise(resolve => setTimeout(resolve, milliseconds))
}

// ref: https://stackoverflow.com/a/54261558/577298
// ref: https://stackoverflow.com/a/2274327/577298
const readStorage = key =>
	new Promise((resolve, reject) =>
		chrome.storage.sync.get([key], result =>
			chrome.runtime.lastError
				? reject(Error(chrome.runtime.lastError.message))
				: resolve(result)
		)
	)

const writeStorage = (key, value) =>
	new Promise((resolve, reject) =>
		chrome.storage.sync.set({ [key]: value }, () =>
			chrome.runtime.lastError
				? reject(Error(chrome.runtime.lastError.message))
				: resolve()
		)
	)

const setIcon = (tabId) => {
	status = tabStatus[tabId];
	if (status === 'verified') {
		chrome.pageAction.setIcon({
			path: "images/success.png",
			tabId: tabId
		});
	} else {
		chrome.pageAction.setIcon({
			path: "images/error.png",
			tabId: tabId
		});
	}
}

if (typeof (window) === 'undefined') {
	// handle console run for testing
	var openpgp = require('openpgp');
	var fetch = require('node-fetch');
	verify('http://bafybeid4yuxsupkihtng3um6epzdpccmvk5fot53azgqcexz3pa3evrvue.ipfs.localhost:8080/');
} else {
	// handle browser load
	chrome.runtime.onInstalled.addListener(function () {
		console.log("Installed Islands.");

		// chrome.storage.sync.clear();

		// only enable extension for IPFS URLs
		chrome.declarativeContent.onPageChanged.removeRules(undefined, function () {
			chrome.declarativeContent.onPageChanged.addRules([{
				conditions: [
					new chrome.declarativeContent.PageStateMatcher({pageUrl: { hostContains: ".ipfs.localhost" },}),
					new chrome.declarativeContent.PageStateMatcher({pageUrl: { hostContains: ".ipns.localhost" },})
				],
				actions: [
					new chrome.declarativeContent.ShowPageAction(),
				]
			}]);
		});
	});

	// update button click state tracker
	chrome.notifications.onClosed.addListener(function (notificationId) {
		console.log("[" + notificationId + "] closed");
		if (!(notificationId in notificationButtonClickState)
			|| (notificationButtonClickState[notificationId] === undefined)
			|| (notificationButtonClickState[notificationId] === -1)) {
			console.log("[" + notificationId + "] set to default value");
			notificationButtonClickState[notificationId] = -1;
		}
	});
	chrome.notifications.onClicked.addListener(function (notificationId) {
		console.log("[" + notificationId + "] clicked");
		notificationButtonClickState[notificationId] = -1;
	});
	chrome.notifications.onButtonClicked.addListener(function (notificationId, buttonIndex) {
		console.log("[" + notificationId + "]", "button", buttonIndex, "pressed");
		notificationButtonClickState[notificationId] = buttonIndex;
	});

	// launch verification process when tab content is loaded or reloaded
	chrome.tabs.onUpdated.addListener(function (tab_id, info) {
		if (info.status === 'complete') {
			console.log("Finished loading tab", tab_id);
			tabStatus[tab_id] = "loaded";

			chrome.tabs.query({ active: true, lastFocusedWindow: true }, tabs => {
				tabs.forEach(async function (tab, index, array) {
					if (tab.id == tab_id) {
						url = tab.url;
						for (let i = 0; i < urlPatterns.length; i++) {
							if (url.indexOf(urlPatterns[i]) >= 0) {
								console.log("Verifying", tab.url);
								tabStatus[tab_id] = await verify(tab.url);
								setIcon(tab_id);
							}
						}
					}
				})
			});
		}
	});

	chrome.tabs.onActivated.addListener(activeTab => {
		let tabId = activeTab.tabId;
		console.log("Activated tab", tabId);
		url = activeTab.url;
		if (typeof (url) !== 'undefined') {
			for (let i = 0; i < urlPatterns.length; i++) {
				if (url.indexOf(urlPatterns[i]) >= 0) {
					setIcon(tab_id);
				}
			}
		}
	});
}

async function getRealUrl(url) {
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

async function getSignature(url) {
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

async function getStoredPubkey(hostname) {
	let pubkey = null;
	let pubkey_text = null;

	console.log("Searching trusted key store for ", hostname);

	pubkey_text_result = await readStorage(hostname);
	console.log("pubkey_text_result", pubkey_text_result);
	if (Object.entries(pubkey_text_result).length !== 0) {
		pubkey_text = pubkey_text_result[hostname]
		console.log(pubkey_text);
		pubkey = await openpgp.key.readArmored(pubkey_text);
		console.log(pubkey);
		return pubkey;
	}

	return null;
}

async function getPubkey(url) {
	let pubkey = null;
	let pubkey_text = null;

	// check for trusted pubkey
	const hostname = new URL(url).hostname;
	console.log("Checking for trusted pubkey for", hostname);

	let stored_pubkey = await getStoredPubkey(hostname);

	let pubkey_url = new URL(url);
	pubkey_url.pathname = "pubkey.asc";
	console.log("Checking for", pubkey_url.toString());
	const response = await fetch(pubkey_url);
	var potential_pubkey = null;
	if (response.ok) {
		pubkey_text = await response.text();
		potential_pubkey = await openpgp.key.readArmored(pubkey_text);
	}

	let prompt_id = "trust-key-prompt";
	if (stored_pubkey === null) {
		// prompt user for pubkey trust
		notificationButtonClickState[prompt_id] = -1;
		chrome.notifications.create(notificationId = prompt_id, options = {
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
	} else if (potential_pubkey.keys[0].getFingerprint() !== stored_pubkey.keys[0].getFingerprint()) {
		notificationButtonClickState[prompt_id] = -1;
		chrome.notifications.create(notificationId = prompt_id, options = {
			type: "basic",
			requireInteraction: true,
			title: "Public Key Changed! Trust new key?",
			message: "Host: " + hostname + "\nKey Fingerprint: " + potential_pubkey.keys[0].getFingerprint(),
			iconUrl: "images/error.png",
			buttons: [
				{ title: "Yes" },
				{ title: "No" },
			],
		});
	} else {
		return stored_pubkey;
	}

	const sleep_interval = 250;
	let count = 0;
	while (!(prompt_id in notificationButtonClickState)
		|| (notificationButtonClickState[prompt_id] === undefined)
		|| (notificationButtonClickState[prompt_id] === -1)) {
		console.log("Waiting for pubkey trust decision...");
		await sleep(sleep_interval);
		count += sleep_interval;
	}

	if (notificationButtonClickState[prompt_id] == 0) {
		pubkey = potential_pubkey;
		await writeStorage(hostname, pubkey_text);
		console.log("Trusted key", pubkey.keys[0].getFingerprint(), "for host", hostname);
		return pubkey;
	} else {
		console.log("User doesn't trust pubkey.");
		return pubkey;
	}
}

async function getContent(url) {
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
	url = await getRealUrl(url);
	console.log("real url:", url)
	if (url == null) {
		console.log("Failed to get real URL.");
		return 'real-url-fail';
	}

	const signature = await getSignature(url);
	console.log("signature:", signature)
	if (signature == null) {
		console.log("Failed to obtain signature file.");
		return 'sig-fail';
	}

	const pubkey = await getPubkey(url);
	console.log("pubkey:", pubkey)
	if (pubkey == null || typeof (pubkey.err) !== 'undefined') {
		console.log("Failed to obtain public key.");
		return 'pubkey-fail';
	}

	const message = await getContent(url);
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
