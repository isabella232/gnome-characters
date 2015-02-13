// -*- Mode: js; indent-tabs-mode: nil; c-basic-offset: 4; tab-width: 4 -*-
//
// Copyright (c) 2013 Giovanni Campagna <scampa.giovanni@gmail.com>
//
// Redistribution and use in source and binary forms, with or without
//  modification, are permitted provided that the following conditions are met:
//   * Redistributions of source code must retain the above copyright
//     notice, this list of conditions and the following disclaimer.
//   * Redistributions in binary form must reproduce the above copyright
//     notice, this list of conditions and the following disclaimer in the
//     documentation and/or other materials provided with the distribution.
//   * Neither the name of the GNOME Foundation nor the
//     names of its contributors may be used to endorse or promote products
//     derived from this software without specific prior written permission.
//
// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
// ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
// WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
// DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER BE LIABLE FOR ANY
// DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
// (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
// LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
// ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
// (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
// SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const GObject = imports.gi.GObject;
const Gtk = imports.gi.Gtk;
const Lang = imports.lang;
const Params = imports.params;
const CategoryList = imports.categoryList;
const Character = imports.character;
const CharacterList = imports.characterList;
const Pango = imports.gi.Pango;
const Gc = imports.gi.Gc;
const Gettext = imports.gettext;

const Main = imports.main;
const Util = imports.util;

const MAX_SEARCH_RESULTS = 100;

const MainWindow = new Lang.Class({
    Name: 'MainWindow',
    Extends: Gtk.ApplicationWindow,
    Template: 'resource:///org/gnome/Characters/mainwindow.ui',
    InternalChildren: ['main-headerbar', 'search-active-button',
                       'search-bar', 'search-entry',
                       'main-grid', 'main-hbox', 'sidebar-grid'],
    Properties: {
        'search-active': GObject.ParamSpec.boolean(
            'search-active', '', '',
            GObject.ParamFlags.READABLE | GObject.ParamFlags.WRITABLE, false)
    },

    _init: function(params) {
        params = Params.fill(params, { title: GLib.get_application_name(),
                                       default_width: 640,
                                       default_height: 480 });
        this.parent(params);

        this._searchActive = false;
        this._searchKeywords = [];

        Util.initActions(this,
                         [{ name: 'about',
                            activate: this._about },
                          { name: 'search-active',
                            activate: this._toggleSearch,
                            parameter_type: new GLib.VariantType('b'),
                            state: new GLib.Variant('b', false) },
                          { name: 'category',
                            activate: this._category,
                            parameter_type: new GLib.VariantType('s'),
                            state: new GLib.Variant('s', 'punctuation') },
                          { name: 'character',
                            activate: this._character,
                            parameter_type: new GLib.VariantType('s') }]);

        this.bind_property('search-active', this._search_active_button, 'active',
                           GObject.BindingFlags.SYNC_CREATE |
                           GObject.BindingFlags.BIDIRECTIONAL);
        this.bind_property('search-active',
                           this._search_bar,
                           'search-mode-enabled',
                           GObject.BindingFlags.SYNC_CREATE |
                           GObject.BindingFlags.BIDIRECTIONAL);
        this._search_bar.connect_entry(this._search_entry);
        this._search_entry.connect('search-changed',
                                   Lang.bind(this, this._handleSearchChanged));

        this._categoryList = new CategoryList.CategoryListWidget();
        this._sidebar_grid.add(this._categoryList);

        this._mainView = new MainView();
        this._main_hbox.pack_start(this._mainView, true, true, 0);
        this._main_grid.show_all();

        // Due to limitations of gobject-introspection wrt GdkEvent
        // and GdkEventKey, this needs to be a signal handler
        this.connect('key-press-event', Lang.bind(this, this._handleKeyPress));
    },

    get search_active() {
        return this._searchActive;
    },

    set search_active(v) {
        if (this._searchActive == v)
            return;

        this._searchActive = v;
        this.notify('search-active');
    },

    _handleSearchChanged: function(entry) {
        let text = entry.get_text().replace(/^\s+|\s+$/g, '');
        let keywords = text == '' ? [] : text.split(/\s+/);
        keywords = keywords.map(String.toUpperCase);
        if (keywords != this._searchKeywords) {
            this._searchKeywords = keywords;
            if (this._searchKeywords.length > 0)
                this._mainView.startSearch(this._searchKeywords);
            else
                this._mainView.cancelSearch();
        }
        return true;
    },

    _handleKeyPress: function(self, event) {
        return this._search_bar.handle_event(event);
    },

    _about: function() {
        let aboutDialog = new Gtk.AboutDialog(
            { authors: [ 'Daiki Ueno <dueno@src.gnome.org>' ],
              translator_credits: _("translator-credits"),
              program_name: _("GNOME Characters"),
              comments: _("Character Map"),
              copyright: 'Copyright 2014 Daiki Ueno',
              license_type: Gtk.License.GPL_2_0,
              logo_icon_name: 'org.gnome.Characters',
              version: pkg.version,
              website: 'http://www.example.com/gnome-characters/',
              wrap_license: true,
              modal: true,
              transient_for: this
            });

        aboutDialog.show();
        aboutDialog.connect('response', function() {
            aboutDialog.destroy();
        });
    },

    _category: function(action, v) {
        let [name, length] = v.get_string()

        // FIXME: we could use Gtk.Container.get_child to obtain the
        // title, but it is not introspectable.
        let category = null;
        for (let index in CategoryList.Category) {
            category = CategoryList.Category[index];
            if (category.name == name)
                break;
        }

        Util.assertNotEqual(category, null);
        this._mainView.setPage(category.name);
        this._main_headerbar.title = Gettext.gettext(category.title);
    },

    _character: function(action, v) {
        let [uc, length] = v.get_string()
        this._mainView.selectCharacter(uc);
    },
});

const MainView = new Lang.Class({
    Name: 'MainView',
    Extends: Gtk.Stack,
    Template: 'resource:///org/gnome/Characters/mainview.ui',
    InternalChildren: ['loading-banner-spinner'],
    Properties: {
        'max-recent-characters': GObject.ParamSpec.uint(
            'max-recent-characters', '', '',
            GObject.ParamFlags.READABLE | GObject.ParamFlags.WRITABLE,
            0, GLib.MAXUINT32, 100)
    },

    get max_recent_characters() {
        return this._maxRecentCharacters;
    },

    set max_recent_characters(v) {
        this._maxRecentCharacters = v;
        if (this._recentCharacters.length > this._maxRecentCharacters)
            this._recentCharacters = this._recentCharacters.slice(
                0, this._maxRecentCharacters);
    },

    _init: function(params) {
        params = Params.fill(params, { hexpand: true, vexpand: true });
        this.parent(params);

        this._characterListWidgets = {};

        let characterList;
        for (let index in CategoryList.Category) {
            let category = CategoryList.Category[index];
            characterList = this._createCharacterList();
            characterList.get_accessible().accessible_name =
                _('%s Character List').format(category.title);
            this._characterListWidgets[category.name] = characterList;
            this.add_titled(this._createScrolledWindow(characterList),
                            category.name,
                            category.title);
        }

        characterList = this._createCharacterList();
        characterList.get_accessible().accessible_name =
            _('Search Result Character List');
        this.add_named(this._createScrolledWindow(characterList),
                       'search-result');
        this._characterListWidgets['search-result'] = characterList;

        this._spinnerTimeoutId = 0;

        // FIXME: Can't use GSettings.bind with 'as' from Gjs
        let recentCharacters = Main.settings.get_value('recent-characters');
        this._recentCharacters = recentCharacters.get_strv();
        this._maxRecentCharacters = 100;
        Main.settings.bind('max-recent-characters', this,
                           'max-recent-characters',
                           Gio.SettingsBindFlags.DEFAULT);

        this._cancellable = new Gio.Cancellable();
    },

    _createCharacterList: function() {
        let widget = new CharacterList.CharacterListWidget({ hexpand: true,
                                                             vexpand: true });
        widget.connect('character-selected',
                       Lang.bind(this, this._handleCharacterSelected));
        return widget;
    },

    _createScrolledWindow: function(widget) {
        let scroll = new Gtk.ScrolledWindow({
            hscrollbar_policy: Gtk.PolicyType.NEVER
        });
        scroll.add(widget);
        return scroll;
    },

    _startSearch: function() {
        this._cancellable.cancel();
        this._cancellable.reset();

        if (this.visible_child_name != 'search-banner' &&
            this.visible_child_name != 'search-result')
            this._lastPage = this.visible_child_name;

        this._spinnerTimeoutId =
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000,
                             Lang.bind(this, function () {
                                 this._loading_banner_spinner.start();
                                 this.visible_child_name = 'loading-banner';
                                 this.show_all();
                             }));
    },

    _finishSearch: function(name, result) {
        if (this._spinnerTimeoutId > 0) {
            GLib.source_remove(this._spinnerTimeoutId);
            this._spinnerTimeoutId = 0;
            this._loading_banner_spinner.stop();
        }

        let characters = [];
        for (let index = 0; index < result.len; index++) {
            characters.push(Gc.search_result_get(result, index));
        }

        let characterList = this._characterListWidgets[name];
        characterList.setCharacters(characters);

        if (characters.length == 0) {
            this.visible_child_name = 'search-banner';
        } else {
            this.visible_child_name = name;
        }
        this.show_all();
    },

    startSearch: function(keywords) {
        this._startSearch();
        Gc.search_by_keywords(
            keywords,
            MAX_SEARCH_RESULTS,
            this._cancellable,
            Lang.bind(this, function(source_object, res, user_data) {
                try {
                    let result = Gc.search_finish(res);
                    this._finishSearch('search-result', result);
                } catch (e) {
                    log("Failed to search by keywords: " + e);
                }
            }));
    },

    cancelSearch: function() {
        this._cancellable.cancel();
        this._finishSearch('search-result', []);
        if (this._lastPage)
            this.visible_child_name = this._lastPage;
    },

    setPage: function(name) {
        if (!(name in this._characterListWidgets))
            return;

        let characterList = this._characterListWidgets[name];
        if (name == 'recent') {
            if (this._recentCharacters.length == 0)
                this.visible_child_name = 'search-banner';
            else {
                characterList.setCharacters(this._recentCharacters);
                characterList.show_all();
                this.visible_child_name = name;
            }
            this.show_all();
        } else {
            let category = null;
            for (let index in CategoryList.Category) {
                category = CategoryList.Category[index];
                if (category.name == name)
                    break;
            }

            Util.assertNotEqual(category, null);
            this._startSearch();
            Gc.search_by_category(
                category.category,
                -1,
                this._cancellable,
                Lang.bind(this,
                          function(source_object, res, user_data) {
                              try {
                                  let result = Gc.search_finish(res);
                                  this._finishSearch(name, result);
                              } catch (e) {
                                  log("Failed to search by category: " + e);
                              }
                          }));
        }
    },

    selectCharacter: function(uc) {
        if (this._recentCharacters.indexOf(uc) < 0) {
            this._recentCharacters.push(uc);
            if (this._recentCharacters.length > this._maxRecentCharacters)
                this._recentCharacters = this._recentCharacters.slice(
                    0, this._maxRecentCharacters);
            Main.settings.set_value(
                'recent-characters',
                GLib.Variant.new_strv(this._recentCharacters));

            if (this.visible_child_name == 'recent')
                this.setPage('recent');
        }
    },

    _handleCharacterSelected: function(widget, uc) {
        this.selectCharacter(uc);

        let dialog = new Character.CharacterDialog({
            character: uc,
            modal: true,
            transient_for: this.get_toplevel()
        });

        dialog.show();
        dialog.connect('response', function(self, response_id) {
            if (response_id == Gtk.ResponseType.CLOSE)
                dialog.destroy();
        });
    }
});
