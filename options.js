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
	let storedPubkeyResult = await readStorage(keyClass);
	let storedPubkeys = storedPubkeyResult[keyClass];
	if (typeof (storedPubkeys) !== 'undefined') {
		for (let i = 0; i < storedPubkeys.length; i++) {
			let storedPubkeyText = storedPubkeys[i];
			let pubkeyParseResult = await openpgp.key.readArmored(storedPubkeyText);
			if ('err' in pubkeyParseResult) {
				console.log("Error parsing pubkey", pubkeyParseResult.err);
			} else {
				for (const pubkey of pubkeyParseResult.keys) {
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
		const importText = importElement.value;

		const pubkeyReadResult = await openpgp.key.readArmored(importText);
		console.log("Key import result", pubkeyReadResult);
		if ('err' in pubkeyReadResult) {
			console.log("Error parsing pubkey", pubkeyReadResult.err);
			for (const e of pubkeyReadResult.err) {
				alert(e);
			}
		} else {
			for (const pubkey of pubkeyReadResult.keys) {
				await trustPubkey(pubkey);
			}
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
