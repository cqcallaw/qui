chrome.runtime.sendMessage({ id: "tab_status" }, function (response) {
	console.log("[popup] Got response", response);
	if (response.id == 'tab_status') {
		console.log("[popup] Got status", response.status);
		let messageElement = document.getElementById('message');
		messageElement.innerHTML = response.status;
	}
});
