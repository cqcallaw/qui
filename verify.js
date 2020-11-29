request_timeout = 3000;

var url = 'http://bafybeid4yuxsupkihtng3um6epzdpccmvk5fot53azgqcexz3pa3evrvue.ipfs.localhost:8080/'
if (typeof(window) !== 'undefined') {
	url = window.location.href;
} else {
	var XMLHttpRequest = require("xmlhttprequest").XMLHttpRequest;;
	var openpgp = require('openpgp');
	var fetch = require('node-fetch');
}

const sleep = (milliseconds) => {
	return new Promise(resolve => setTimeout(resolve, milliseconds))
}

function has_keys(keys, dict) {
	for (let i = 0; i < keys.length; i++) {
		if (!(keys[i] in dict)) {
			return false;
		}
	}
	return true;
}

async function get_signature(url) {
	let signature = null;

	// ASCII-armored signatures
	let sig_url = url + ".asc"
	console.log("Checking for", sig_url);
	let response = await fetch(sig_url);
	if (response.ok) {
		text = await response.text();
		signature = await openpgp.signature.readArmored(text);
		return signature
	}

	// Binary signatures
	sig_url = url + ".sig"
	console.log("Checking for", sig_url);
	response = await fetch(sig_url);
	if (response.ok) {
		data = new Uint8Array(await response.arrayBuffer());
		signature = await openpgp.signature.read(data);
		return signature
	}

	return signature;
}

async function get_pubkey(url) {
	let pubkey = null;

	let base_url = new URL(url);
	base_url.pathname = "pubkey.asc";
	console.log("Checking for", base_url.toString());

	const request = await fetch(base_url);
	const response = await request.text();
	pubkey = await openpgp.key.readArmored(response);

	return pubkey;
}

async function verify() {
	console.log("Verifying", url)

	if (url.substr(-1) === '/') {
		console.log(url, "does not contain path information, checking for real path...")
		// ref: https://stackoverflow.com/a/10926978/577298
		real_url_dict = {}
		path_names = ['index', 'index.html']

		// send async HTTP requests for each possible real path
		path_names.forEach(key => {
			const request = new XMLHttpRequest();
			request.timeout = request_timeout;
			const real_url = url + key;
			console.log("Checking", real_url);
			request.onreadystatechange = function () {
				if (request.readyState === 4) {
					console.log(real_url, "result", request.status);
					real_url_dict[key] = request.status;
				}
			}
			request.open('GET', real_url, true);
			request.send();
		})

		// wait for all async requests to finish
		const timeout = request_timeout + 1000;
		const sleep_interval = 250;
		let count = 0;
		console.log("Waiting for real path requests to complete...");
		while (!has_keys(path_names, real_url_dict) && count <= timeout) {
			await sleep(sleep_interval);
			count += sleep_interval;
		}

		if (!has_keys(path_names, real_url_dict)) {
			console.log("Failed to query real URL.")
			return;
		}

		let real_url = ""
		for (const key in real_url_dict) {
			if (real_url_dict[key] >= 200 && real_url_dict[key] < 300) {
				real_url = url + key;
				break;
			}
		}

		if (real_url === "") {
			console.log("No valid real URL found.")
			return;
		}

		url = real_url;
		console.log("Using real URL", url);
	}

	signature = await get_signature(url);
	if (signature == null) {
		console.log("Failed to obtain signature file.");
		return;
	}

	pubkey = await get_pubkey(url);
	if (pubkey == null) {
		console.log("Failed to obtain public key.");
		return;
	}

	const response = await fetch(url);
	if (!response.ok) {
		console.log("Failed to retrieve", url, "for verification");
		return;
	}

	// verify bytes because not all signed files are text
	const data = new Uint8Array(await response.arrayBuffer());
	const message = openpgp.message.fromBinary(data);

	const verified = await openpgp.verify({
		message: message,
		signature: signature,
		publicKeys: pubkey.keys
	})

	const { valid } = verified.signatures[0];
	if (valid) {
		console.log('Verified signature by key id ' + verified.signatures[0].keyid.toHex());
	} else {
		console.log('Failed to verify', url);
		console.log(verified);
	}
}

verify();
