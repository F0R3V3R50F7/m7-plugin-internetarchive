/**
 * Internet Archive plugin for M7 Media Center
 *
 *  Copyright (C) 2024 F0R3V3R50F7
 */

var page = require('movian/page');
var service = require('movian/service');
var settings = require('movian/settings');
var http = require('movian/http');
var string = require('native/string');
var popup = require('native/popup');
var store = require('movian/store');
var plugin = JSON.parse(Plugin.manifest);
var logo = Plugin.path + plugin.icon;

function setPageHeader(page, title) {
  page.metadata.title = title;
  page.metadata.logo = logo;
  page.metadata.background = Plugin.path + "bg.png";
  page.metadata.icon = Plugin.path + plugin.icon;
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

function addMediaItem(page, media) {
  var item = page.appendItem("internetarchive:files:" + media.identifier, "directory", {
    title: media.title,
    icon: "https://archive.org/services/img/" + media.identifier,
    description: "Type: " + media.mediatype
  });
  item.icon = "https://archive.org/services/img/" + media.identifier;
  page.entries++;
}

function addDiscoverSection(page) {
  var offset = 1;
  var count = 9;

  function loader() {
    if (!offset) return false;
    page.loading = true;

    var args = {
      q: 'mediatype:(movies OR audio)',
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
      var item = c.response.docs[i];
      if (item.mediatype === 'movies' || item.mediatype === 'audio') {
        addMediaItem(page, item);
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

new page.Route("internetarchive:popular", function(page) {
  setPageHeader(page, "All Popular Items");
  page.model.contents = 'grid';

  var args = {
    q: 'mediatype:movies',
    fl: ["identifier", "title", "mediatype"],
    sort: ["downloads desc"],
    rows: 100,
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
    if (video.mediatype === 'movies') {
      addMediaItem(page, video);
    }
  }
});

new page.Route("internetarchive:files:(.*)", function(page, id) {
  setPageHeader(page, id);
  var encodedId = encodeURIComponent(id);
  var listingImage = "https://archive.org/services/img/" + encodedId;
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

  var mediaFiles = metadata.files.filter(function(file) {
    return /\.(mp4|avi|3gp|mp3|ogg|m4a)$/.test(file.name);
  });

  if (mediaFiles.length === 0) {
    page.appendItem('', 'separator', {
      title: 'No media files found in the selected item.'
    });
    page.loading = false;
    return;
  }

  var media = {
    identifier: id,
    title: metadata.metadata.title || "Unknown Title",
    mediatype: metadata.metadata.mediatype || "Unknown Type",
    icon: "https://archive.org/services/img/" + id
  };

  page.options.createAction('addItemToFavorites', 'Save this Item to My Favorites', function() {
    addToFavorites(media);
  });

  page.options.createAction('removeItemFromFavorites', 'Remove this Item from My Favorites', function() {
    removeFromFavorites(media.identifier);
  });

  mediaFiles.forEach(function(file) {
    var mediaUrl = 'https://archive.org/download/' + encodedId + '/' + encodeURIComponent(file.name);
    var type = /\.(mp4|avi|3gp)$/.test(file.name) ? 'video' : 'audio';
    page.appendItem(mediaUrl, type, {
      title: file.name,
      sources: [{ url: mediaUrl }],
      icon: listingImage
    });
  });

  page.loading = false;
  popup.notify("Some Files (May) Be Restricted.", 5);
});

var favorites = store.create('favorites');
if (!favorites.list) {
  favorites.list = JSON.stringify([]);
}

function addToFavorites(video) {
  var list = JSON.parse(favorites.list);
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
    favorites.list = JSON.stringify(list);
  }
}

function removeFromFavorites(videoId) {
  var list = JSON.parse(favorites.list);
  var video = getVideoById(videoId);
  if (video) {
    var decodedTitle = decodeURIComponent(video.title);
    popup.notify('\'' + decodedTitle + '\' has been removed from My Favorites.', 3);
    list = list.filter(function(fav) {
      return fav.identifier !== videoId;
    });
    favorites.list = JSON.stringify(list);
  } else {
    popup.notify('Video not found in favorites.', 3);
  }
}

function isFavorite(videoId) {
  var list = JSON.parse(favorites.list);
  return list.some(function(fav) {
    return fav.identifier === videoId;
  });
}

function getVideoById(videoId) {
  var list = JSON.parse(favorites.list);
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
      page.metadata.title = "Internet Archive";
    page.model.contents = 'grid';
    for (var i in c.response.docs) {
      var item = c.response.docs[i];
      if (item.mediatype === 'movies' || item.mediatype === 'audio') {
        addMediaItem(page, item);
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
  
      var list = JSON.parse(favorites.list);
      var pos = 0;
      for (var i = list.length - 1; i >= 0 && pos < 4; i--) {
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
      title: 'Discover: Most Popular Archives'
    });
    page.appendItem('', 'separator', {
      title: ''
    });
    page.appendItem(plugin.id + ":search:", 'search', {
      title: 'Search Archive.org'
    });
  
    addDiscoverSection(page);
  
    page.appendItem("internetarchive:popular", "directory", {
      title: "Show All...",
      icon: "https://i.postimg.cc/cJLV4kMN/seemore.png"
    });
  
    page.loading = false;
    popup.notify("Visit Archive.org and Donate if you can!", 7);
});

new page.Route(plugin.id + ':favorites', function(page) {
    page.metadata.icon = 'https://i.postimg.cc/zGT28Cz2/favs.png';
    setPageHeader(page, "My Favorites");
    page.model.contents = 'grid';
    popup.notify("Empty My Favorites in the Side-Menu", 7);
  
    page.options.createAction('cleanFavorites', 'Empty My Favorites', function() {
      favorites.list = '[]';
      popup.notify('Favorites has been emptied successfully', 3);
      page.redirect(plugin.id + ':start');
    });
  
    page.appendItem(plugin.id + ":favorites", "directory", {
      title: "Refresh",
      icon: 'https://i.postimg.cc/T1j3TpwG/refresh.png'
    });
  
    var favoritesList = JSON.parse(favorites.list);
    for (var i = favoritesList.length - 1; i >= 0; i--) {
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