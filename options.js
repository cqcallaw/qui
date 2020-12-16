async function removeKey(keyClass, index, fingerprint) {
	console.log("Removing key", fingerprint);
	if (confirm('Delete key with fingerprint ' + fingerprint.toUpperCase() + '?')) {
		console.log('Begin removal at index', index);

		let out = []
		let stored_pubkey_result = await readStorage(keyClass);
		console.log("Stored pubkey result", stored_pubkey_result);
		let pubkeys = stored_pubkey_result[keyClass];
		console.log("Stored pubkeys", pubkeys);
		if (typeof (pubkeys) !== 'undefined') {
			for (let i = 0; i < pubkeys.length; i++) {
				if (i != index) {
					out.push(pubkeys[i]);
				}
			}
		}
		console.log("output", out);
		await writeStorage(keyClass, out)
	} else {
		console.log('User cancelled host removal.');
	}
}

async function generateKeyList(keyClass) {
	console.log("Generating key list for class", keyClass);
	let keyList = document.getElementById(keyClass);
	keyList.textContent = '';
	let stored_pubkey_result = await readStorage(keyClass);
	let pubkeys = stored_pubkey_result[keyClass];
	if (typeof (pubkeys) !== 'undefined') {
		for (let i = 0; i < pubkeys.length; i++) {
			let pubkey_text = pubkeys[i];
			let pubkey_result = await openpgp.key.readArmored(pubkey_text);
			if ('err' in pubkey_result) {
				console.log("Error parsing pubkey", pubkey_result.err);
			} else {
				for (const pubkey of pubkey_result.keys) {
					// add fingerprint
					let fingerprintElement = document.createElement('dt');
					let fingerprint = pubkey.getFingerprint();
					fingerprintElement.innerHTML = fingerprint.toUpperCase();

					// add delete button
					let delButton = document.createElement('input');
					delButton.type = 'button';
					delButton.value = 'Remove';
					delButton.className = 'remove';
					delButton.onclick = () => removeKey(keyClass, i, fingerprint);
					fingerprintElement.appendChild(delButton);

					keyList.appendChild(fingerprintElement);

					// add user IDs
					let userIds = pubkey.getUserIds();
					// add in reverse order; primary UID is last in the array
					for (let j = userIds.length - 1; j >= 0; j--) {
						let userIdElement = document.createElement('dd');
						userIdElement.className = 'user_id';
						userIdElement.appendChild(document.createTextNode(userIds[j]));
						keyList.appendChild(userIdElement);
					}
				}
			}
		}
	}
}

async function setupOptions() {
	let trustPromptResult = await readStorage('trust_prompt');
	let trustPrompt = trustPromptResult.trust_prompt;
	let trustPromptElement = document.getElementById('trust_prompt');
	trustPromptElement.checked = trustPrompt;
	trustPromptElement.addEventListener('change', function () {
		writeStorage('trust_prompt', this.checked);
	});
}

async function setupImport() {
	const importActionElement = document.getElementById('import_action');
	importActionElement.onclick = async function () {
		const importElement = document.getElementById('import');
		const pubkey_text = importElement.value;

		const potential_pubkey_result = await openpgp.key.readArmored(pubkey_text);
		console.log("Key import result", potential_pubkey_result);
		if ('err' in potential_pubkey_result) {
			console.log("Error parsing pubkey", potential_pubkey_result.err);
			for (const e of potential_pubkey_result.err) {
				alert(e);
			}
		} else if (potential_pubkey_result.keys.length > 1) {
			// can't handle multiple pubkeys; we must serialize as armored text because JSON deserialization of keys throws an exception,
			// and armored text serialization doesn't allow us to merge keys
			alert("Armored text contains multiple keys, which is currently unsupported. Please import each key separately.");
		}
		else {
			await trustPubkey(pubkey_text);
		}
	}
}

chrome.storage.onChanged.addListener(function (changes, namespace) {
	console.log("Storage change, reloading...");
	generateKeyList('trusted');
});

window.addEventListener('load', (event) => {
	generateKeyList('trusted');
	setupOptions();
	setupImport();
});
