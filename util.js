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

async function trustPubkey(pubkey) {
	pubkeys = [];

	pubkeys_result = await readStorage('trusted');
	// create default key set if no keys are stored
	if (Object.entries(pubkeys_result).length !== 0) {
		pubkeys = pubkeys_result.trusted;
		console.info("Read pubkeys", pubkeys);
	}

	pubkeys.push(pubkey);
	return await writeStorage('trusted', pubkeys);
}

async function loadTrustedPubkeys() {
	let pubkeys = []

	pubkey_text_result = await readStorage('trusted');
	console.info("pubkey_text_result", pubkey_text_result);
	if (Object.entries(pubkey_text_result).length !== 0) {
		for (const key_text of pubkey_text_result.trusted) {
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
