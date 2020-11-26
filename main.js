chrome.runtime.onInstalled.addListener(function () {
	// chrome.storage.sync.set({ color: '#3aa757' }, function () {
	console.log("Installed Islands.");
	// });
	chrome.declarativeContent.onPageChanged.removeRules(undefined, function () {
		chrome.declarativeContent.onPageChanged.addRules([{
			conditions: [new chrome.declarativeContent.PageStateMatcher({
				pageUrl: { hostContains: 'localhost' },
			})
			],
			actions: [
				new chrome.declarativeContent.ShowPageAction(),
			]
		}]);
	});
});
