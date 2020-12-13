async function removeKey(index, fingerprint) {
	console.log("Removing key", fingerprint);
	if (confirm('Delete key with fingerprint ' + fingerprint.toUpperCase() + '?')) {
		console.log('Begin removal');

		let out = []
		let pubkeys = await readStorage('pubkeys');
		for (let i = 0; i < pubkeys.length; i++) {
			if (i != index) {
				out.push(pubkeys[i]);
			}
		}

		console.log("output", pubkeys);

		await writeStorage('pubkeys', out)

	} else {
		console.log('User cancelled host removal.');
	}
}

async function generateKeyList() {
	console.log("Generating key list");
	let keyList = document.getElementById('key-list');
	keyList.textContent = '';
	let pubkey_result = await readStorage('pubkeys');
	let pubkeys = pubkey_result.pubkeys;
	console.log("Stored pubkeys", pubkeys);
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
				fingerprintElement.appendChild(document.createTextNode(fingerprint.toUpperCase()));

				// add delete button
				let delButton = document.createElement('input');
				delButton.type = 'button';
				delButton.value = 'Remove';
				delButton.className = 'remove';
				delButton.onclick = () => removeKey(i, fingerprint);
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

chrome.storage.onChanged.addListener(function (changes, namespace) {
	console.log("Storage change, reloading...");
	generateKeyList();
});

window.addEventListener('load', (event) => {
	generateKeyList();
});
