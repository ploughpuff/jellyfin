define(["loading", "dialogHelper", "dom", "listViewStyle", "emby-input", "emby-button", "paper-icon-button-light", "css!./directorybrowser", "formDialogStyle", "emby-linkbutton"], function(loading, dialogHelper, dom) {
    "use strict";

    function getSystemInfo() {
        return systemInfo ? Promise.resolve(systemInfo) : ApiClient.getPublicSystemInfo().then(function(info) {
            return systemInfo = info, info
        })
    }

    function onDialogClosed() {
        loading.hide()
    }

    function refreshDirectoryBrowser(page, path, fileOptions, updatePathOnError) {
        if (path && "string" != typeof path) throw new Error("invalid path");
        loading.show();
        var promises = [];
        "Network" === path ? promises.push(ApiClient.getNetworkDevices()) : path ? (promises.push(ApiClient.getDirectoryContents(path, fileOptions)), promises.push(ApiClient.getParentPath(path))) : promises.push(ApiClient.getDrives()), Promise.all(promises).then(function(responses) {
            var folders = responses[0],
                parentPath = responses[1] || "";
            page.querySelector("#txtDirectoryPickerPath").value = path || "";
            var html = "";
            path && (html += getItem("lnkPath lnkDirectory", "", parentPath, "..."));
            for (var i = 0, length = folders.length; i < length; i++) {
                var folder = folders[i];
                html += getItem("File" === folder.Type ? "lnkPath lnkFile" : "lnkPath lnkDirectory", folder.Type, folder.Path, folder.Name)
            }
            path || (html += getItem("lnkPath lnkDirectory", "", "Network", Globalize.translate("ButtonNetwork"))), page.querySelector(".results").innerHTML = html, loading.hide()
        }, function() {
            updatePathOnError && (page.querySelector("#txtDirectoryPickerPath").value = ""), page.querySelector(".results").innerHTML = "", loading.hide()
        })
    }

    function getItem(cssClass, type, path, name) {
        var html = "";
        return html += '<div class="listItem listItem-border ' + cssClass + '" data-type="' + type + '" data-path="' + path + '">', html += '<div class="listItemBody" style="padding-left:0;padding-top:.5em;padding-bottom:.5em;">', html += '<div class="listItemBodyText">', html += name, html += "</div>", html += "</div>", html += '<i class="md-icon" style="font-size:inherit;">arrow_forward</i>', html += "</div>"
    }

    function getEditorHtml(options, systemInfo) {
        var html = "";
        if (html += '<div class="formDialogContent scrollY">', html += '<div class="dialogContentInner dialog-content-centered" style="padding-top:2em;">', !options.pathReadOnly) {
            var instruction = options.instruction ? options.instruction + "<br/><br/>" : "";
            html += '<div class="infoBanner" style="margin-bottom:1.5em;">', html += instruction, html += Globalize.translate("MessageDirectoryPickerInstruction").replace("{0}", "<b>\\\\server</b>").replace("{1}", "<b>\\\\192.168.1.101</b>"), "synology" === (systemInfo.PackageName || "").toLowerCase() ? (html += "<br/>", html += "<br/>", html += '<a is="emby-linkbutton" class="button-link" href="https://github.com/MediaBrowser/Wiki/wiki/Synology-:-Setting-Up-Your-Media-Library-Share" target="_blank">' + Globalize.translate("LearnHowToCreateSynologyShares") + "</a>") : "bsd" === systemInfo.OperatingSystem.toLowerCase() ? (html += "<br/>", html += "<br/>", html += Globalize.translate("MessageDirectoryPickerBSDInstruction"), html += "<br/>", html += '<a is="emby-linkbutton" class="button-link" href="http://doc.freenas.org/9.3/freenas_jails.html#add-storage" target="_blank">' + Globalize.translate("ButtonMoreInformation") + "</a>") : "linux" === systemInfo.OperatingSystem.toLowerCase() && (html += "<br/>", html += "<br/>", html += Globalize.translate("MessageDirectoryPickerLinuxInstruction"), html += "<br/>"), html += "</div>"
        }
        html += '<form style="margin:auto;">', html += '<div class="inputContainer" style="display: flex; align-items: center;">', html += '<div style="flex-grow:1;">';
        var labelKey = !0 !== options.includeFiles ? "LabelFolder" : "LabelPath",
            readOnlyAttribute = options.pathReadOnly ? " readonly" : "";
        return html += '<input is="emby-input" id="txtDirectoryPickerPath" type="text" required="required" ' + readOnlyAttribute + ' label="' + Globalize.translate(labelKey) + '"/>', html += "</div>", readOnlyAttribute || (html += '<button type="button" is="paper-icon-button-light" class="btnRefreshDirectories emby-input-iconbutton" title="' + Globalize.translate("ButtonRefresh") + '"><i class="md-icon">search</i></button>'), html += "</div>", readOnlyAttribute || (html += '<div class="results paperList" style="max-height: 200px; overflow-y: auto;"></div>'), options.enableNetworkSharePath && (html += '<div class="inputContainer" style="margin-top:2em;">', html += '<input is="emby-input" id="txtNetworkPath" type="text" label="' + Globalize.translate("LabelOptionalNetworkPath") + '"/>', html += '<div class="fieldDescription">', html += Globalize.translate("LabelOptionalNetworkPathHelp"), html += "</div>", html += "</div>"), html += '<div class="formDialogFooter">', html += '<button is="emby-button" type="submit" class="raised button-submit block formDialogFooterItem">' + Globalize.translate("ButtonOk") + "</button>", html += "</div>", html += "</form>", html += "</div>", html += "</div>", html += "</div>"
    }

    function alertText(text) {
        alertTextWithOptions({
            text: text
        })
    }

    function alertTextWithOptions(options) {
        require(["alert"], function(alert) {
            alert(options)
        })
    }

    function validatePath(path, validateWriteable, apiClient) {
        return apiClient.ajax({
            type: "POST",
            url: apiClient.getUrl("Environment/ValidatePath"),
            data: {
                ValidateWriteable: validateWriteable,
                Path: path
            }
        }).catch(function(response) {
            if (response) {
                if (404 === response.status) return alertText("The path could not be found. Please ensure the path is valid and try again."), Promise.reject();
                if (500 === response.status) return alertText(validateWriteable ? "Jellyfin Server requires write access to this folder. Please ensure write access and try again." : "The path could not be found. Please ensure the path is valid and try again."), Promise.reject()
            }
            return Promise.resolve()
        })
    }

    function initEditor(content, options, fileOptions) {
        content.addEventListener("click", function(e) {
            var lnkPath = dom.parentWithClass(e.target, "lnkPath");
            if (lnkPath) {
                var path = lnkPath.getAttribute("data-path");
                lnkPath.classList.contains("lnkFile") ? content.querySelector("#txtDirectoryPickerPath").value = path : refreshDirectoryBrowser(content, path, fileOptions, !0)
            }
        }), content.addEventListener("click", function(e) {
            if (dom.parentWithClass(e.target, "btnRefreshDirectories")) {
                var path = content.querySelector("#txtDirectoryPickerPath").value;
                refreshDirectoryBrowser(content, path, fileOptions)
            }
        }), content.addEventListener("change", function(e) {
            var txtDirectoryPickerPath = dom.parentWithTag(e.target, "INPUT");
            txtDirectoryPickerPath && "txtDirectoryPickerPath" === txtDirectoryPickerPath.id && refreshDirectoryBrowser(content, txtDirectoryPickerPath.value, fileOptions)
        }), content.querySelector("form").addEventListener("submit", function(e) {
            if (options.callback) {
                var networkSharePath = this.querySelector("#txtNetworkPath");
                networkSharePath = networkSharePath ? networkSharePath.value : null;
                var path = this.querySelector("#txtDirectoryPickerPath").value;
                validatePath(path, options.validateWriteable, ApiClient).then(function() {
                    options.callback(path, networkSharePath)
                })
            }
            return e.preventDefault(), e.stopPropagation(), !1
        })
    }

    function getDefaultPath(options) {
        return options.path ? Promise.resolve(options.path) : ApiClient.getJSON(ApiClient.getUrl("Environment/DefaultDirectoryBrowser")).then(function(result) {
            return result.Path || ""
        }, function() {
            return ""
        })
    }

    function directoryBrowser() {
        var currentDialog, self = this;
        self.show = function(options) {
            options = options || {};
            var fileOptions = {
                includeDirectories: !0
            };
            null != options.includeDirectories && (fileOptions.includeDirectories = options.includeDirectories), null != options.includeFiles && (fileOptions.includeFiles = options.includeFiles), Promise.all([getSystemInfo(), getDefaultPath(options)]).then(function(responses) {
                var systemInfo = responses[0],
                    initialPath = responses[1],
                    dlg = dialogHelper.createDialog({
                        size: "medium-tall",
                        removeOnClose: !0,
                        scrollY: !1
                    });
                dlg.classList.add("ui-body-a"), dlg.classList.add("background-theme-a"), dlg.classList.add("directoryPicker"), dlg.classList.add("formDialog");
                var html = "";
                html += '<div class="formDialogHeader">', html += '<button is="paper-icon-button-light" class="btnCloseDialog autoSize" tabindex="-1"><i class="md-icon">&#xE5C4;</i></button>', html += '<h3 class="formDialogHeaderTitle">', html += options.header || Globalize.translate("HeaderSelectPath"), html += "</h3>", html += "</div>", html += getEditorHtml(options, systemInfo), dlg.innerHTML = html, initEditor(dlg, options, fileOptions), dlg.addEventListener("close", onDialogClosed), dialogHelper.open(dlg), dlg.querySelector(".btnCloseDialog").addEventListener("click", function() {
                    dialogHelper.close(dlg)
                }), currentDialog = dlg, dlg.querySelector("#txtDirectoryPickerPath").value = initialPath;
                var txtNetworkPath = dlg.querySelector("#txtNetworkPath");
                txtNetworkPath && (txtNetworkPath.value = options.networkSharePath || ""), options.pathReadOnly || refreshDirectoryBrowser(dlg, initialPath, fileOptions, !0)
            })
        }, self.close = function() {
            currentDialog && dialogHelper.close(currentDialog)
        }
    }
    var systemInfo;
    return directoryBrowser
});
