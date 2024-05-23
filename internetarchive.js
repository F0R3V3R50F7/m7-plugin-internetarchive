/**
 * Internet Archive plugin for Movian Media Center
 *
 *  Copyright (C) 2024 F0R3V3R50F7
 */

var page = require('showtime/page');
var service = require('showtime/service');
var settings = require('showtime/settings');
var http = require('showtime/http');
var string = require('native/string');
var popup = require('native/popup');
var store = require('movian/store');
var plugin = JSON.parse(Plugin.manifest);
var logo = Plugin.path + plugin.icon;

function setPageHeader(page, title) {
    if (page.metadata) {
        page.metadata.title = title;
        page.metadata.logo = logo;
        page.metadata.background = Plugin.path + "bg.png"
    }
    page.type = "directory";
    page.contents = "items";
    page.entries = 0;
    page.loading = true;
}

service.create(plugin.title, plugin.id + ":start", 'video', true, logo);

settings.globalSettings(plugin.id, plugin.title, logo, plugin.synopsis);
settings.createBool('disableMyFavorites', 'Disable My Favorites', false, function(v) {
    service.disableMyFavorites = v;
});

function addDiscoverSection(page) {
    var offset = 1;
    var count = 9; // Number of popular videos to display

    function loader() {
        if (!offset) return false;
        page.loading = true;

        var args = {
            q: 'mediatype:movies',
            fl: ["identifier", "title", "mediatype"],
            sort: ["downloads desc"],
            rows: count,
            page: offset,
            output: "json"
        };

        try {
            var c = JSON.parse(http.request("https://archive.org/advancedsearch.php", {
                args: args
            }));
        } catch(err) {
            page.error('Failed to fetch data from Internet Archive.');
            return;
        }

        if (offset == 1) {
            page.appendItem("", "separator", {
                title: ''
            });
        }

        page.loading = false;
        for (var i in c.response.docs) {
            var video = c.response.docs[i];
            if (video.mediatype === 'movies') { // Filter out non-video files
                addVideoItem(page, video);
                if (page.entries >= count) return offset = false;
            }
        }

        offset++;
        return c.response.docs && c.response.docs.length > 0;
    }
    loader();
    page.paginator = loader;
    page.loading = false;
}

// Route to display all popular items without pagination
new page.Route("internetarchive:popular", function(page) {
    setPageHeader(page, "All Popular Items");
    page.model.contents = 'grid';

    var args = {
        q: 'mediatype:movies',
        fl: ["identifier", "title", "mediatype"],
        sort: ["downloads desc"],
        rows: 100, // Fetch all items at once
        output: "json"
    };

    try {
        var c = JSON.parse(http.request("https://archive.org/advancedsearch.php", {
            args: args
        }));
    } catch(err) {
        page.error('Failed to fetch data from Internet Archive.');
        return;
    }

    page.loading = false;
    for (var i in c.response.docs) {
        var video = c.response.docs[i];
        if (video.mediatype === 'movies') { // Filter out non-video files
            addVideoItem(page, video);
        }
    }
});

// Route to display the files of a selected item
new page.Route("internetarchive:files:(.*)", function(page, id) {
    setPageHeader(page, id);
    var encodedId = encodeURIComponent(id);
    var listingImage = "https://archive.org/services/img/" + encodedId;
    // Set the background to the listing image
    page.metadata.background = listingImage;
    var itemUrl = 'https://archive.org/metadata/' + encodedId;

    var response;
    try {
        response = http.request(itemUrl);
    } catch (err) {
        page.error("Failed to fetch item metadata.");
        page.loading = false;
        return;
    }

    var metadata = JSON.parse(response);
    if (!metadata || !metadata.files || metadata.files.length === 0) {
        page.appendItem('', 'separator', {
            title: 'No files found in the selected item.'
        });
        page.loading = false;
        return;
    }

    var videoFiles = metadata.files.filter(function(file) {
        return /\.(mp4|avi|3gp)$/.test(file.name); // Filter video files by extension
    });

    if (videoFiles.length === 0) {
        page.appendItem('', 'separator', {
            title: 'No video files found in the selected item.'
        });
        page.loading = false;
        return;
    }

    var video = {
        identifier: id,
        title: metadata.metadata.title || "Unknown Title",
        mediatype: metadata.metadata.mediatype || "Unknown Type",
        icon: "https://archive.org/services/img/" + id
    };

    page.options.createAction('addItemToFavorites', 'Save this Item to My Favorites', function() {
        addToFavorites(video);
    });

    page.options.createAction('removeItemFromFavorites', 'Remove this Item from My Favorites', function() {
        removeFromFavorites(video.identifier);
    });

    videoFiles.forEach(function(file) {
        var videoUrl = 'https://archive.org/download/' + encodedId + '/' + encodeURIComponent(file.name);
        page.appendItem(videoUrl, 'video', {
            title: file.name,
            sources: [{ url: videoUrl }],
            icon: listingImage // Use the listing image URL as the thumbnail
        });
    });

    page.loading = false;
});

var favorites = store.create('favorites');
if (!store.list) {
    store.list = JSON.stringify([]);
}

function addToFavorites(video) {
    var list = JSON.parse(store.list);
    if (isFavorite(video.identifier)) {
        popup.notify('\'' + video.title + '\' is already in My Favorites.', 3);
    } else {
        popup.notify('\'' + video.title + '\' has been added to My Favorites.', 3);
        var favoriteItem = {
            identifier: video.identifier,
            title: encodeURIComponent(video.title),
            icon: video.icon ? encodeURIComponent(video.icon) : null,
            link: encodeURIComponent("internetarchive:files:" + video.identifier)
        };
        list.push(favoriteItem);
        store.list = JSON.stringify(list);
    }
}

function removeFromFavorites(videoId) {
    var list = JSON.parse(store.list);
    var video = getVideoById(videoId);
    if (video) {
        popup.notify('\'' + video.title + '\' has been removed from My Favorites.', 3);
        list = list.filter(function(fav) {
            return fav.identifier !== videoId;
        });
        store.list = JSON.stringify(list);
    } else {
        popup.notify('Video not found in favorites.', 3);
    }
}

function isFavorite(videoId) {
    var list = JSON.parse(store.list);
    return list.some(function(fav) {
        return fav.identifier === videoId;
    });
}

function getVideoById(videoId) {
    var list = JSON.parse(store.list);
    for (var i = 0; i < list.length; i++) {
        if (list[i].identifier === videoId) {
            return list[i];
        }
    }
    return null;
}

function browseItems(page, query, count) {
    var offset = 1;
    page.entries = 0;

    function loader() {
        if (!offset) return false;
        page.loading = true;

        var args = {
            q: query,
            fl: ["identifier", "title", "mediatype"],
            sort: ["downloads desc"],
            rows: count ? count : 50,
            page: offset,
            output: "json"
        };

        try {
            var c = JSON.parse(http.request("https://archive.org/advancedsearch.php", {
                args: args
            }));
        } catch(err) {
            page.error('Failed to fetch data from Internet Archive.');
            return;
        }

        page.loading = false;
        if (offset == 1 && page.metadata && c.response.numFound)
            page.metadata.title = "Search results: " + c.response.numFound;
        for (var i in c.response.docs) {
            var video = c.response.docs[i];
            if (video.mediatype === 'movies') { // Filter out non-video files
                addVideoItem(page, video);
                if (count && page.entries >= count) return offset = false;
            }
        }
        offset++;
        return c.response.docs && c.response.docs.length > 0;
    }
    loader();
    page.paginator = loader;
    page.loading = false;
}

function addVideoItem(page, video) {
    var item = page.appendItem("internetarchive:files:" + video.identifier, "directory", {
        title: video.title,
        icon: "https://archive.org/services/img/" + video.identifier,
        description: "Type: " + video.mediatype
    });
    item.icon = "https://archive.org/services/img/" + video.identifier;
    page.entries++;
}

new page.Route(plugin.id + ":start", function(page) {
    setPageHeader(page, plugin.title);
    page.metadata.background = Plugin.path + "bg.png";
    page.model.contents = 'grid';


    if (!service.disableMyFavorites) {
        page.appendItem('', 'separator', {
            title: 'My Favorites',
        });
        page.appendItem('', 'separator', {
            title: '',
        });

        var list = JSON.parse(store.list);
        var pos = 0;
        for (var i in list) {
            if (pos >= 4) break; // Stop after listing 4 items
            var itemmd = list[i];
            var item = page.appendItem(decodeURIComponent(itemmd.link), 'directory', {
                title: decodeURIComponent(itemmd.title),
                icon: itemmd.icon ? decodeURIComponent(itemmd.icon) : null,
                description: 'Link: ' + decodeURIComponent(itemmd.link)
            });
            pos++;
        }

        if (!list || list.length === 0) {
            page.appendItem(plugin.id + ":start", "directory", {
                title: "Refresh",
                icon: 'https://i.postimg.cc/T1j3TpwG/refresh.png'
            });
        } else if (list.length < 4) {
            page.appendItem(plugin.id + ":start", "directory", {
                title: "Refresh",
                icon: 'https://i.postimg.cc/T1j3TpwG/refresh.png'
            });
        }

        if (list && list.length > 0) {
            page.appendItem(plugin.id + ":favorites", "directory", {
                title: "Show All...",
                icon: 'https://i.postimg.cc/zGT28Cz2/favs.png'
            });
        }
    }

    page.appendItem('', 'separator', {
        title: 'Discover: Most Popular Videos'
    });
    page.appendItem('', 'separator', {
        title: ''
    });
    page.appendItem(plugin.id + ":search:", 'search', {
        title: 'Search Archive.org'
    });

    addDiscoverSection(page);

    // Add button to navigate to a new page containing all popular items
    page.appendItem("internetarchive:popular", "directory", {
        title: "Show All...",
        icon: "https://i.postimg.cc/zGT28Cz2/favs.png"
    });

    page.loading = false;
});

// My Favorites Page
new page.Route(plugin.id + ':favorites', function(page) {
    page.metadata.icon = 'https://i.postimg.cc/zGT28Cz2/favs.png';
    setPageHeader(page, "My Favorites");
    page.model.contents = 'grid';
    popup.notify("Empty My Favorites in the Side-Menu", 7);

    page.options.createAction('cleanFavorites', 'Empty My Favorites', function() {
        store.list = '[]';
        popup.notify('Favorites has been emptied successfully', 3);
        page.redirect(plugin.id + ':start');
    });

    var favoritesList = JSON.parse(store.list);
    for (var i = 0; i < favoritesList.length; i++) {
        var favorite = favoritesList[i];
        var item = page.appendItem(decodeURIComponent(favorite.link), "directory", {
            title: decodeURIComponent(favorite.title),
            icon: favorite.icon ? decodeURIComponent(favorite.icon) : null,
            description: 'Link: ' + decodeURIComponent(favorite.link)
        });
    }

    page.loading = false;
});

new page.Route(plugin.id + ":search:(.*)", function(page, query) {
    page.metadata.background = Plugin.path + "bg.png"
    setPageHeader(page, "Search results for: " + query);
    page.model.contents = 'grid';
    browseItems(page, query);
});

page.Searcher(plugin.title, logo, function(page, query) {
    browseItems(page, query);
});