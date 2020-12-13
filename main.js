var tabStatus = {}
var notificationButtonClickState = {}

const urlPatterns = [".ipfs.localhost", ".ipns.localhost"]

const sleep = (milliseconds) => {
	return new Promise(resolve => setTimeout(resolve, milliseconds))
}
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
					new chrome.declarativeContent.PageStateMatcher({ pageUrl: { hostContains: ".ipfs.localhost" }, }),
					new chrome.declarativeContent.PageStateMatcher({ pageUrl: { hostContains: ".ipns.localhost" }, })
				],
				actions: [
					new chrome.declarativeContent.ShowPageAction(),
				]
			}]);
		});
	});

	// update button click state tracker
	chrome.notifications.onClosed.addListener(function (notificationId) {
		console.info("[" + notificationId + "] closed");
		if (!(notificationId in notificationButtonClickState)
			|| (notificationButtonClickState[notificationId] === undefined)
			|| (notificationButtonClickState[notificationId] === -1)) {
			console.info("[" + notificationId + "] set to default value");
			notificationButtonClickState[notificationId] = -1;
		}
	});
	chrome.notifications.onClicked.addListener(function (notificationId) {
		console.info("[" + notificationId + "] clicked");
		notificationButtonClickState[notificationId] = -1;
	});
	chrome.notifications.onButtonClicked.addListener(function (notificationId, buttonIndex) {
		console.info("[" + notificationId + "]", "button", buttonIndex, "pressed");
		notificationButtonClickState[notificationId] = buttonIndex;
	});

	// launch verification process when tab content is loaded or reloaded
	chrome.tabs.onUpdated.addListener(function (tab_id, info) {
		if (info.status === 'complete') {
			// console.log("Finished loading tab", tab_id);
			tabStatus[tab_id] = "loaded";

			chrome.tabs.query({ active: true, lastFocusedWindow: true }, tabs => {
				tabs.forEach(async function (tab, index, array) {
					if (tab.id == tab_id) {
						url = tab.url;
						for (let i = 0; i < urlPatterns.length; i++) {
							if (url.indexOf(urlPatterns[i]) >= 0) {
								console.log("Verifying", tab.url);
								chrome.pageAction.setIcon({
									path: "images/working.png",
									tabId: tab_id
								});
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
		console.info("Activated tab", tabId);
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
	console.info("Checking for", sig_url);
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
	console.info("Checking for", sig_url);
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

async function loadPubkeys() {
	let pubkeys = []

	pubkey_text_result = await readStorage('pubkeys');
	console.info("pubkey_text_result", pubkey_text_result);
	if (Object.entries(pubkey_text_result).length !== 0) {
		for (const key_text of pubkey_text_result.pubkeys) {
			let pubkey_result = await openpgp.key.readArmored(key_text);
			if ('err' in pubkey_result) {
				console.error("Error parsing pubkey", pubkey_result.err);
			} else {
				for (const pubkey of pubkey_result.keys) {
					pubkeys.push(pubkey);
				}
			}
		}
	}

	return pubkeys;
}

async function storePubkey(pubkey) {
	// append to existing pubkeys
	pubkeys = [];

	pubkeys_result = await readStorage('pubkeys');
	// create default key set if no keys are stored
	if (Object.entries(pubkeys_result).length !== 0) {
		pubkeys = pubkeys_result.pubkeys;
		console.info("Read pubkeys", pubkeys);
	}

	pubkeys.push(pubkey);
	return await writeStorage('pubkeys', pubkeys);
}

async function getPubkeys(url) {
	let pubkey = null;
	let pubkey_text = null;

	let pubkeys = await loadPubkeys();

	console.info("Stored pubkeys:", pubkeys);

	let pubkey_url = new URL(url);
	pubkey_url.pathname = "pubkey.asc";
	console.info("Checking for", pubkey_url.toString());
	const response = await fetch(pubkey_url);
	let potential_pubkeys = [];
	if (response.ok) {
		pubkey_text = await response.text();
		potential_pubkey_result = await openpgp.key.readArmored(pubkey_text);
		if ('err' in potential_pubkey_result) {
			console.log("Error parsing pubkey", potential_pubkey.err);
		} else {
			for (const pubkey of potential_pubkey_result.keys) {
				potential_pubkeys.push(pubkey);
			}
		}
	}

	console.info("Potential pubkey", potential_pubkeys);

	for (const potential_pubkey of potential_pubkeys) {
		let trusted = false;
		for (const stored_pubkey of pubkeys) {
			if (potential_pubkey.getFingerprint() === stored_pubkey.getFingerprint()) {
				console.info(potential_pubkey.getFingerprint(), "is trusted.");
				trusted = true;
			}
		}

		if (!trusted) {
			key = potential_pubkey;
			console.info("Verifying trust for", key);

			// prompt user for pubkey trust
			let prompt_id = "trust-key-prompt";
			notificationButtonClickState[prompt_id] = -1;
			let user = await key.getPrimaryUser();
			chrome.notifications.create(notificationId = prompt_id, options = {
				type: "basic",
				requireInteraction: true,
				title: "Trust Public Key?",
				message: "User: " + user.user.userId.userid + "\nFingerprint: " + key.getFingerprint().toUpperCase(),
				iconUrl: "images/working.png",
				buttons: [
					{ title: "Trust" },
					{ title: "Ignore" },
				],
			});

			const sleep_interval = 250;
			let count = 0;
			while (!(prompt_id in notificationButtonClickState)
				|| (notificationButtonClickState[prompt_id] === undefined)
				|| (notificationButtonClickState[prompt_id] === -1)) {
				console.info("Waiting for pubkey trust decision...");
				await sleep(sleep_interval);
				count += sleep_interval;
			}

			if (notificationButtonClickState[prompt_id] == 0) {
				console.log("Trusted key", key.getFingerprint());
				pubkeys.push(key);
				await storePubkey(pubkey_text);
			} else {
				console.log("User doesn't trust pubkey.");
			}
		}
	}

	return pubkeys;
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

	const pubkeys = await getPubkeys(url);
	console.log("pubkeys:", pubkeys)
	if (pubkeys == null || typeof (pubkeys.err) !== 'undefined') {
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
		publicKeys: pubkeys
	})

	console.log("verified:", verified)
	const { valid } = verified.signatures[0];
	if (valid) {
		console.log('Verified signature by key id ' + verified.signatures[0].keyid.toHex());
		return 'verified';
	} else {
		console.error('Failed to verify', url);
		console.error(verified);
		return 'verify-fail';
	}
}
