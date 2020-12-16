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

async function trustPubkey(pubkeyText) {
	pubkeys = [];

	pubkeys_result = await readStorage('trusted');
	if (Object.entries(pubkeys_result).length !== 0) {
		pubkeys = pubkeys_result.trusted;
		console.info("Read stored pubkeys", pubkeys);
	}

	// check for existing trust; no need to duplicate entries
	trusted = false;
	for (const pubkey of pubkeys) {
		if (pubkey === pubkeyText) {
			trusted = true;
		}
	}

	if (!trusted) {
		/* Serialize public keys as ASCII-armored text;
		openpgp.js throws an error when reconstituting keys from JSON
		*/
		pubkeys.push(pubkeyText);
		console.log("Added pubkey to trusted key store.");
	}

	return await writeStorage('trusted', pubkeys);
}

async function loadTrustedPubkeys() {
	let pubkeys = []

	pubkey_text_result = await readStorage('trusted');
	if (Object.entries(pubkey_text_result).length !== 0) {
		pubkeys = pubkeys_result.trusted;
		console.info("Read stored pubkeys", pubkeys);
		for (const key_text of pubkeys) {
			/* Deserialize public keys as ASCII-armored text;
			openpgp.js throws an error when reconstituting keys from JSON
			*/
			let pubkey_result = await openpgp.key.readArmored(key_text);
			if ('err' in pubkey_result) {
				console.log("Error parsing pubkey", pubkey_result.err);
			} else {
				for (const pubkey of pubkey_result.keys) {
					pubkeys.push(pubkey);
				}
			}
		}
	}

	return pubkeys;
}
