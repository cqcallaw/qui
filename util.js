const sleep = (milliseconds) => {
	return new Promise(resolve => setTimeout(resolve, milliseconds))
}

function addDelimiter(str, delimiter, n) {
	out = '';
	out += str.charAt(0);
	for (i = 1; i < str.length; i++) {
		if (i % n === 0) {
			out += delimiter;
		}
		out += str.charAt(i);
	}

	return out;
}

const urlPatterns = [".ipfs.localhost", ".ipns.localhost"]

function verifyUrlPattern(url) {
	for (const urlPattern of urlPatterns) {
		if (typeof (url) !== 'undefined' && url.indexOf(urlPattern) >= 0) {
			return true;
		}
	}

	return false;
}

// ref: https://stackoverflow.com/a/54261558/577298
// ref: https://stackoverflow.com/a/2274327/577298
const readStorage = key =>
	new Promise((resolve, reject) =>
		chrome.storage.local.get([key], result =>
			chrome.runtime.lastError
				? reject(Error(chrome.runtime.lastError.message))
				: resolve(result)
		)
	)

const writeStorage = (key, value) =>
	new Promise((resolve, reject) =>
		chrome.storage.local.set({ [key]: value }, () =>
			chrome.runtime.lastError
				? reject(Error(chrome.runtime.lastError.message))
				: resolve()
		)
	)

function checkTrusted(trustedPubkeys, subject) {
	for (const trustedPubkey of trustedPubkeys) {
		if (subject.getFingerprint() === trustedPubkey.getFingerprint()) {
			console.info(subject.getFingerprint(), "is trusted.");
			return true;
		}
	}

	return false;
}

async function trustPubkey(pubkey) {
	let result = [];

	let trustedPubkeys = await loadTrustedPubkeys();

	for (const trustedPubkey of trustedPubkeys) {
		result.push(trustedPubkey.armor());
	}

	// check for existing trust; no need to duplicate entries
	let trusted = checkTrusted(trustedPubkeys, pubkey);

	if (!trusted) {
		/* Serialize public keys as ASCII-armored text;
		openpgp.js throws an error when reconstituting keys from JSON
		*/
		result.push(pubkey.armor());
		console.log("Added pubkey to trusted key store.");
	}

	return await writeStorage('trusted', result);
}

async function loadTrustedPubkeys() {
	let pubkeys = []

	let trustedStoreReadResult = await readStorage('trusted');
	if (Object.entries(trustedStoreReadResult).length !== 0) {
		pubkeys = trustedStoreReadResult.trusted;
		for (const keyText of pubkeys) {
			/* Deserialize public keys as ASCII-armored text;
			openpgp.js throws an error when reconstituting keys from JSON
			*/
			let parseResult = await openpgp.key.readArmored(keyText);
			if ('err' in parseResult) {
				console.log("Error parsing pubkey", parseResult.err);
			} else {
				pubkeys = parseResult.keys;
			}
		}
	}

	return pubkeys;
}
