# THIS FILE IS AUTO-GENERATED. DO NOT MODIFY!!

# Copyright 2020-2023 Tauri Programme within The Commons Conservancy
# SPDX-License-Identifier: Apache-2.0
# SPDX-License-Identifier: MIT

-keep class com.protofs.app.* {
  native <methods>;
}

-keep class com.protofs.app.WryActivity {
  public <init>(...);

  void setWebView(com.protofs.app.RustWebView);
  java.lang.Class getAppClass(...);
  int getId();
  java.lang.String getVersion();
  int startActivity(...);
}

-keep class com.protofs.app.Ipc {
  public <init>(...);

  @android.webkit.JavascriptInterface public <methods>;
}

-keep class com.protofs.app.RustWebView {
  public <init>(...);

  void loadUrlMainThread(...);
  void loadHTMLMainThread(...);
  void evalScript(...);
}

-keep class com.protofs.app.RustWebChromeClient,com.protofs.app.RustWebViewClient {
  public <init>(...);
}
