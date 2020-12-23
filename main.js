/*
 * Qui - Verify the authenticity of dWebpages signed by PGP.
 * Copyright (C) 2020 Caleb Callaway
 *
 * This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License along with this program. If not, see https://www.gnu.org/licenses/.
 */

var tabStatus = {}
var notificationButtonClickState = {}

const statusMap = {
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
	} else if (status === 'verify_fail') {
		chrome.pageAction.setIcon({
			path: "images/error.png",
			tabId: tabId
		});
	} else {
		chrome.pageAction.setIcon({
			path: "images/working.png",
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
		console.log("Installed.");

		// chrome.storage.local.clear();

		// set defaults
		writeStorage('trust_prompt', true);

		// only enable extension for IPFS URIs
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
					let activeTab = tabs[0]
					let status = statusMap[tabStatus[activeTab.id]];
					if (typeof (status) === 'undefined') {
						status = 'Unverified';
					}
					let response = { id: "tab_status", status: status };
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
		if (notificationButtonClickState["trust-key-prompt"] === -1) {
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

async function getSignature(uri) {
	let signature = null;
	let signatureUriExtension = null;
	let signatureResponse = null;

	let pathExtensions = ['index.html.asc', 'index.html.sig', 'index.htm.sig', 'index.htm.asc', 'index.sig', 'index.asc']

	// handle URIs with a real path component
	if (uri.substr(-1) !== '/') {
		console.log(uri, "contains path information, using it...")
		pathExtensions = ['.sig', '.asc']
	}

	for (const pathExtension of pathExtensions) {
		let potential = uri + pathExtension;
		console.log("Checking potential signature path", potential);
		signatureResponse = await fetch(potential)
		if (signatureResponse.ok) {
			signatureUriExtension = pathExtension;
			break;
		}
	}

	if (signatureUriExtension === null) {
		return signature;
	}

	try {
		if (signatureUriExtension.endsWith('.sig')) {
			// binary signature
			data = new Uint8Array(await signatureResponse.arrayBuffer());
			signature = await openpgp.signature.read(data);
			return signature
		} else if (signatureUriExtension.endsWith('.asc')) {
			// ASCII-armored signature
			text = await signatureResponse.text();
			signature = await openpgp.signature.readArmored(text);
			return signature
		}
	} catch (e) {
		console.log("Failed to parse signature file", signatureUriExtension);
		// swallow error so UI can report error cleanly
	}


	return signature;
}

async function getPubkeys(uri, trustPrompt) {
	let trustedPubkeys = await loadTrustedPubkeys();

	if (!trustPrompt) {
		return trustedPubkeys;
	}

	let candidatePubkeyUri = new URL(uri);
	candidatePubkeyUri.pathname = "pubkey.asc";
	console.info("Checking for", candidatePubkeyUri.toString());
	const response = await fetch(candidatePubkeyUri);
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

async function getContent(uri) {
	const response = await fetch(uri);
	if (!response.ok) {
		console.log("Failed to retrieve", uri, "for verification");
		return null;
	}

	// use bytes because not all content is text content
	const data = new Uint8Array(await response.arrayBuffer());
	let message = openpgp.message.fromBinary(data);

	return message;
}

async function verify(uri, trustPrompt) {
	const signature = await getSignature(uri);
	console.log("signature:", signature)
	if (signature == null) {
		return 'sig_fail';
	}

	const pubkeys = await getPubkeys(uri, trustPrompt);
	console.log("pubkeys:", pubkeys)
	if (pubkeys == null || typeof (pubkeys.err) !== 'undefined') {
		return 'pubkey_fail';
	}

	const message = await getContent(uri);
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
	let uri = tab.url;
	// only run if we match a pattern;
	// the background page of the extension runs even if the current page action is disabled
	if (!verifyUriPattern(uri)) return;

	let logPrefix = "[" + tab.id + "]";
	console.log(logPrefix, "Verifying", tab.url);
	tabStatus[tab.id] = "verifying"
	setIcon(tab.id);
	var result = await verify(tab.url, trustPrompt);
	tabStatus[tab.id] = result;
	console.log(logPrefix, statusMap[result]);
	setIcon(tab.id);
}
