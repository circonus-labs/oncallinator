#!/usr/bin/env node

var http = require('http'),
    fs = require('fs'),
    api = require('circonusapi'),
    qs = require('querystring'),
    url = require('url'),
    util = require('util'),
    now = new Date(),
    settings = {},
    schedule = {},
    processing = 0,
    contact_groups = null,
    users = null,
    auth_token = null;

// Load auth token from disk, if this isn't there nothing will work so exit
try {
  auth_token = fs.readFileSync('./.authtoken').toString().replace(/\n/,'');
  if ( ! auth_token ) {
    console.error("Empty .authtoken file");
    process.exit(1);
  }
}
catch (err) {
  console.error("Error reading .authtoken file. " + err);
  process.exit(1);
}

// Load settings and current month schedule from disk, if not there no worries, but log something
try {
  var tmp = fs.readFileSync('./settings.json').toString();
  if ( tmp ) settings = JSON.parse(tmp);

  tmp = fs.readFileSync('./schedules/'+now.getFullYear()+'_'+(now.getMonth()+1)+'.json').toString();
  if ( tmp ) {
    schedule[now.getFullYear()] = {};
    schedule[now.getFullYear()][(now.getMonth()+1)] = JSON.parse(tmp);
  }
}
catch (err) {
  console.error("Error loading initial data. " + err);
}

api.setup(auth_token.toString(), 'oncallinator');

if ( settings.group_id ) {
  if ( settings.hour && now.getHours() >= settings.hour && settings.minute && now.getMinutes() >= settings.minute ) {
    setOnCall();
  }
}

if ( process.argv[2] === '-D' ) {
  setTimeout(dontDaemonize, 1000);
}

function dontDaemonize() {
  if ( processing ) {
    console.log("waiting");
    setTimeout(dontDaemonize, 1000);
    return;
  }
  process.exit(0);
}

http.createServer(function(request, response) {
  if ( request.method == 'GET' ) {
    if      ( request.url.indexOf('/contactgroups')   == 0 ) { getCirconusData('list_contact_groups', response); }
    else if ( request.url.indexOf('/users')           == 0 ) { getCirconusData('list_users', response); }
    else if ( request.url.indexOf('/settings')        == 0 ) { getSettings(request, response); }
    else if ( request.url.indexOf('/schedule')        == 0 ) { getSchedule(request, response); }
    else { streamFile("cal.html", request, response); }
  }
  else if ( request.method == 'POST' ) {
    var request_body = '';
    request.on('data', function(chunk) {
      if ( request_body.length >= 1000000 ) {
        request.connection.destroy();
      }
      request_body += chunk;
    });

    request.on('end', function() {
      var post_data = qs.parse(request_body);

      if      ( request.url.indexOf('/settings')        == 0 ) { saveSettings(post_data, response); }
      else if ( request.url.indexOf('/schedule')        == 0 ) { saveSchedule(post_data, response); }
    });
  }
  else {
    response.statusCode = 405;
  }
}).listen(8080);

function streamFile(filename, request, response) {
  response.statusCode = 200;
  response.setHeader("Content-Type", "text/html");

  var stream = fs.createReadStream("./templates/" + filename);
  stream.on("error", function() { response.statusCode = 500 });
  stream.pipe(response);
};

function getCirconusData(endpoint, response) {
  var cb = function(error, data) {
    if ( error ) {
      response.statusCode = 500;
      response.end();
      return;
    }
    response.statusCode = 200;
    response.write(data);
    response.end();
  };
  api.request('GET', endpoint, cb);
}

function saveSettings(data, response) {
  settings = data;
  fs.writeFile('./settings.json', JSON.stringify(settings), function(err) {
    if ( err ) {
      response.statusCode = 500;
    }
    else {
      response.statusCode = 200;
    }
    response.end();
  });
}

function saveSchedule(data, response) {
  fs.writeFile('./schedules/'+data.year+'_'+data.month+'.json', data.schedule, function(err) {
    if ( err ) {
      response.statusCode = 500;
    }
    else {
      response.statusCode = 200;
      if ( ! schedule[data.year] ) schedule[data.year] = {};
      schedule[data.year][data.month] = JSON.parse(data.schedule);
    }
    response.end();
  });
}

function getSettings(request, response) {
  response.write(JSON.stringify(settings));
  response.end();
}

function getSchedule(request, response) {
  var url_parts = url.parse(request.url, true);
  var query = url_parts.query;

  if ( query.month && query.year ) {
    if ( schedule[query.year] && schedule[query.year][query.month] ) {
      response.write(JSON.stringify(schedule[query.year][query.month]));
    }
    else {
      returnFileContents('./schedules/' + query.year + '_' + query.month + '.json', response);
      return;
    }
  }
  else {
    response.statusCode = 400;
  }
  response.end();
}

function returnFileContents(fn, response) {
  fs.readFile(fn, function(err, data) {
    if ( err ) {
      if ( err.code === 'ENOENT' ) {
        response.statusCode = 404;
      }
      else {
        console.error(err);
        response.statusCode = 500;
      }
      response.end();
      return;
    }

    response.statusCode = 200;
    response.write(data);
    response.end();
  });
}

function setOnCall() {
  if ( settings.group_id ) {
    if ( settings.hour && now.getHours() >= settings.hour && settings.minute && now.getMinutes() >= settings.minute ) {
      if ( schedule[now.getFullYear()] && schedule[now.getFullYear()][(now.getMonth()+1)] && schedule[now.getFullYear()][(now.getMonth()+1)][now.getDate()] ) {
        processing = 1;
        api.request('GET', '/list_contact_groups', function(err, data) {
          if ( err ) {
            console.error(err);
            return;
          }

          contact_groups = JSON.parse(data);
          for ( idx in contact_groups ) {
            var cg = contact_groups[idx];
            if ( cg.contact_group_id == settings.group_id ) {
              checkContactGroup(cg);
              return;
            }
          }

          processing = 0;
          console.error("Contact Group: " + settings.group_id + " no longer exists!");
        });
      }
    }
  }
}

function checkContactGroup(group) {
  var add     = [],
      remove  = [];

  //compare the users in the group to the users in the schedule
  for ( i in group.contacts.user ) {
    var contact = group.contacts.user[i];
    var in_schedule = 0;
    for ( j in schedule[now.getFullYear()][(now.getMonth()+1)][now.getDate()] ) {
      var user = schedule[now.getFullYear()][(now.getMonth()+1)][now.getDate()][j];
      if ( user.user_id == contact.user_id && contact[user.method] ) {
        in_schedule = 1;
      }
    }
    if ( ! in_schedule ) {
      var contact_method;
      for ( key in contact ) {
        if ( key !== 'user_id' ) contact_method = key;
      }
      remove.push({user_id: contact.user_id, method: contact_method});
    }
  }

  //now look at the schedule compared to the group and see who we need to add
  for ( i in schedule[now.getFullYear()][(now.getMonth()+1)][now.getDate()] ) {
    var user = schedule[now.getFullYear()][(now.getMonth()+1)][now.getDate()][i];
    var in_group = 0;
    for ( j in group.contacts.user ) {
      var contact = group.contacts.user[j];
      if ( user.user_id == contact.user_id && contact[user.method] ) {
        in_group = 1;
      }
    }
    if ( ! in_group ) {
      add.push(user);
    }
  }

  if ( add.length || remove.length ) {
    changeContactGroup(add, remove);
  }
  else {
    processing = 0;
  }
}

function changeContactGroup (add, remove) {
  var cb = function(err, data) {
    if ( err ) {
      console.error("Error changing contact group: " + error);
      return;
    }
    else {
      var u = add.pop();
      if ( typeof(u) !== 'undefined' ) {
        api.request('POST', 'add_contact', cb, { contact_group_id: settings.group_id, user_id: u.user_id, contact_method: u.method });
      }
      else {
        u = remove.pop();
        if ( typeof(u) !== 'undefined' ) {
          api.request('POST', 'remove_contact', cb, { contact_group_id: settings.group_id, user_id: u.user_id, contact_method: u.method });
        }
        else {
          processing = 0;
        }
      }
    }
  };

  var u;
  if ( add.length ) {
    u = add.pop();
    api.request('POST', 'add_contact', cb, { contact_group_id: settings.group_id, user_id: u.user_id, contact_method: u.method });
  }
  else {
    u = remove.pop();
    api.request('POST', 'remove_contact', cb, { contact_group_id: settings.group_id, user_id: u.user_id, contact_method: u.method });
  }
}
