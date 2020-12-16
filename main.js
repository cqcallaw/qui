var tabStatus = {}
var notificationButtonClickState = {}

const statusMap = {
	real_url_fail: "No real URL found",
	sig_fail: "No signature found",
	pubkey_fail: "Failed to obtain public key",
	content_fail: "Failed to read signed content",
	verified: "Verification succeeded",
	verifying: "Verification in progress",
	verify_fail: "Verification failed"
}

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
	}
	else if (status === 'verifying') {
		chrome.pageAction.setIcon({
			path: "images/working.png",
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

		// chrome.storage.local.clear();

		// set defaults
		writeStorage('trust_prompt', true);

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
	chrome.tabs.onUpdated.addListener(function (tabId, info) {
		if (info.status === 'complete') {
			triggerVerify();
		}
	});

	// launch verification process if tab is switched
	chrome.tabs.onActivated.addListener(activeTab => {
		console.info("Activated tab", activeTab);
		if (!(activeTab.tabId in tabStatus)) {
			triggerVerify();
		}
	});

	// handle requests for status from popup
	chrome.runtime.onMessage.addListener(
		function (request, sender, sendResponse) {
			console.log("[background] Got request", request);
			if (request.id == "tab_status") {
				chrome.tabs.query({ active: true, lastFocusedWindow: true }, tabs => {
					console.log("[background] tab query response", tabs);
					activeTab = tabs[0]
					let response = { id: "tab_status", status: statusMap[tabStatus[activeTab.id]] };
					console.log("[background] Sending response", response);
					sendResponse(response);
				});

				// ref: https://support.google.com/chrome/thread/2047906?hl=en
				return true;
			}
		}
	);

	// invalidate verification status if our keystore changes and verification isn't in progress
	chrome.storage.onChanged.addListener(function (changes, namespace) {
		console.log("Storage change, reloading...");
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

async function getPubkeys(url) {
	let pubkey_text = null;

	let trustedPubkeys = await loadTrustedPubkeys();

	let trust_prompt_result = await readStorage('trust_prompt');
	let trust_prompt = trust_prompt_result.trust_prompt;
	if (!trust_prompt) {
		return trustedPubkeys;
	}

	let pubkey_url = new URL(url);
	pubkey_url.pathname = "pubkey.asc";
	console.info("Checking for", pubkey_url.toString());
	const response = await fetch(pubkey_url);
	let potential_pubkeys = [];
	if (response.ok) {
		pubkey_text = await response.text();
		potential_pubkey_result = await openpgp.key.readArmored(pubkey_text);
		if ('err' in potential_pubkey_result) {
			console.log("Error parsing pubkey", potential_pubkey_result.err);
		} else {
			potential_pubkeys = potential_pubkey_result.keys;
		}
	}

	console.info("Potential pubkeys", potential_pubkeys);

	for (const potential_pubkey of potential_pubkeys) {
		let trusted = checkTrusted(trustedPubkeys, potential_pubkey);

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
			while (!(prompt_id in notificationButtonClickState)
				|| (notificationButtonClickState[prompt_id] === undefined)
				|| (notificationButtonClickState[prompt_id] === -1)) {
				console.info("Waiting for pubkey trust decision...");
				await sleep(sleep_interval);
			}

			if (notificationButtonClickState[prompt_id] == 0) {
				console.log("Trusting key", key.getFingerprint());
				trustedPubkeys.push(key);
				await trustPubkey(key);
			} else {
				console.log("User doesn't trust pubkey.");
			}
		}
	}

	return trustedPubkeys;
}

async function getContent(url) {
	const response = await fetch(url);
	if (!response.ok) {
		console.log("Failed to retrieve", url, "for verification");
		return null;
	}

	// use bytes because not all content is text content
	const data = new Uint8Array(await response.arrayBuffer());
	let message = openpgp.message.fromBinary(data);

	return message;
}

async function verify(url) {
	url = await getRealUrl(url);
	console.log("real url:", url)
	if (url == null) {
		return 'real_url_fail';
	}

	const signature = await getSignature(url);
	console.log("signature:", signature)
	if (signature == null) {
		return 'sig_fail';
	}

	const pubkeys = await getPubkeys(url);
	console.log("pubkeys:", pubkeys)
	if (pubkeys == null || typeof (pubkeys.err) !== 'undefined') {
		return 'pubkey_fail';
	}

	const message = await getContent(url);
	console.log("message:", message)
	if (openpgp.message == null) {
		return 'content_fail';
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
		console.log(verified);
		return 'verify_fail';
	}
}

async function triggerVerify() {
	chrome.tabs.query({ active: true, lastFocusedWindow: true }, tabs => {
		tabs.forEach(async function (tab, index, array) {
			url = tab.url;
			// only run if we match a pattern;
			// the background page of the extension runs even if the current page action is disabled
			for (let i = 0; i < urlPatterns.length; i++) {
				if (url.indexOf(urlPatterns[i]) >= 0) {
					console.log("Verifying", tab.url);
					tabStatus[tab.id] = "verifying"
					setIcon(tab.id);
					var result = await verify(tab.url);
					tabStatus[tab.id] = result;
					console.log(statusMap[result]);
					setIcon(tab.id);
				}
			}
		})
	});
}
