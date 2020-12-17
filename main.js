/*
Copyright (C) 2020 Caleb Callaway

This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.

You should have received a copy of the GNU General Public License along with this program. If not, see https://www.gnu.org/licenses/.
*/

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
	chrome.tabs.onUpdated.addListener(async function (tabId, info) {
		if (info.status === 'complete') {
			let trustPromptResult = await readStorage('trust_prompt');
			let trustPrompt = trustPromptResult.trust_prompt;
			chrome.tabs.get(tabId, tab => verifyTab(tab, trustPrompt));
		}
	});

	// launch verification process if tab is switched
	chrome.tabs.onActivated.addListener(activeTab => {
		console.info("Activated tab", activeTab);
		if (!(activeTab.tabId in tabStatus)) {
			verifyTab(activeTab, false); // no trust prompt
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

	// invalidate verification status if our keystore changes
	chrome.storage.onChanged.addListener(function (changes, namespace) {
		console.log("Storage change triggered");
		if (notificationButtonClickState["trust-key-prompt"] = -1) {
			// reload only if we aren't in the middle of trusting a new key
			console.log("Storage change, reloading...");
			chrome.tabs.query({}, tabs => {
				tabs.forEach(async function (tab, index, array) {
					verifyTab(tab, false); // no trust prompt
				})
			});
		}
	});
}

async function getRealUrl(url) {
	if (url.substr(-1) === '/') {
		console.log(url, "does not contain path information, checking for real path...")
		// ref: https://stackoverflow.com/a/10926978/577298
		let realUrlDict = {}
		const pathNames = ['index', 'index.htm', 'index.html']

		let realUrl = "";
		for (let index = 0; index < pathNames.length; index++) {
			path = pathNames[index];
			const potential = url + path;
			let response = await fetch(potential);
			if (response.ok) {
				realUrl = potential;
				break;
			}
		}

		if (realUrl === "") {
			console.log("No valid real URL found.")
			return null;
		}

		url = realUrl;
		console.log("Using real URL", url);
	}

	return url;
}

async function getSignature(url) {
	let signature = null;

	// ASCII-armored signatures
	let signatureUrl = url + ".asc"
	console.info("Checking for", signatureUrl);
	let response = await fetch(signatureUrl);
	if (response.ok) {
		text = await response.text();
		try {
			signature = await openpgp.signature.readArmored(text);
			return signature
		} catch (e) {
			console.log("Failed to parse signature file", signatureUrl);
			// swallow error; we may have a valid binary sig
		}
	}

	// Binary signatures
	signatureUrl = url + ".sig"
	console.info("Checking for", signatureUrl);
	response = await fetch(signatureUrl);
	if (response.ok) {
		data = new Uint8Array(await response.arrayBuffer());
		try {
			signature = await openpgp.signature.read(data);
			return signature
		} catch (e) {
			console.log("Failed to parse signature file", signatureUrl);
			// swallow error so UI can report error cleanly
		}
	}

	return signature;
}

async function getPubkeys(url, trustPrompt) {
	let trustedPubkeys = await loadTrustedPubkeys();

	if (!trustPrompt) {
		return trustedPubkeys;
	}

	let candidatePubkeyUrl = new URL(url);
	candidatePubkeyUrl.pathname = "pubkey.asc";
	console.info("Checking for", candidatePubkeyUrl.toString());
	const response = await fetch(candidatePubkeyUrl);
	let candidatePubkeys = [];
	if (response.ok) {
		let responseText = await response.text();
		let candidatePubkeyResult = await openpgp.key.readArmored(responseText);
		if ('err' in candidatePubkeyResult) {
			console.log("Error parsing pubkey", candidatePubkeyResult.err);
		} else {
			candidatePubkeys = candidatePubkeyResult.keys;
		}
	}

	console.info("Potential pubkeys", candidatePubkeys);

	for (const candidatePubkey of candidatePubkeys) {
		let trusted = checkTrusted(trustedPubkeys, candidatePubkey);

		if (!trusted) {
			key = candidatePubkey;
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

			const sleepInterval = 250;
			while (notificationButtonClickState[prompt_id] === -1) {
				console.info("Waiting for pubkey trust decision...");
				await sleep(sleepInterval);
			}

			if (notificationButtonClickState[prompt_id] == 0) {
				console.log("Trusting key", key.getFingerprint());
				trustedPubkeys.push(key);
				await trustPubkey(key);
				notificationButtonClickState[prompt_id] = -1;
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

async function verify(url, trustPrompt) {
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

	const pubkeys = await getPubkeys(url, trustPrompt);
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

async function verifyTab(tab, trustPrompt) {
	url = tab.url;
	// only run if we match a pattern;
	// the background page of the extension runs even if the current page action is disabled
	if (!verifyUrlPattern(url)) return;

	console.log("Verifying", tab.url);
	tabStatus[tab.id] = "verifying"
	setIcon(tab.id);
	var result = await verify(tab.url, trustPrompt);
	tabStatus[tab.id] = result;
	console.log(statusMap[result]);
	setIcon(tab.id);
}
