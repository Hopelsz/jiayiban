package com.jiayiban.app;

import android.os.Bundle;

import androidx.core.view.WindowCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // 内容延伸到状态栏与导航栏后方，配合透明系统栏实现 edge-to-edge 全屏铺满
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
    }
}
