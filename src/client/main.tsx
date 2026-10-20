import { Component, useEffect, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppProvider, useApp, Link } from './core';
import { Loading, Empty } from './ui';
import FriendRoutes from './friend';
import AdminRoutes from './admin';
import './styles.css';

class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <section className="content">
        <Empty title="这一页暂时没能打开" text="已保存的订单仍在，重新打开页面即可再试。">
          <button className="text-action" onClick={() => location.reload()}>
            重新打开
          </button>
        </Empty>
      </section>
    ) : (
      this.props.children
    );
  }
}
function App() {
  const { loading, path, menu, session } = useApp();
  const titles: Record<string, string> = {
    '/login': '朋友登录',
    '/register': '首次注册',
    '/menu': '饮品菜单',
    '/orders': '我的订单',
    '/profile': '我的熟客卡',
    '/owner/login': '店主登录',
    '/owner/board': '制作台',
    '/owner/manage': '菜单与豆单',
    '/owner/settings': '小店设置',
  };
  const known = path === '/' || path in titles || /^\/(customize|orders)\/[^/]+$/.test(path);
  useEffect(() => {
    document.title =
      (titles[path] ||
        (path.startsWith('/customize/')
          ? '选搭配'
          : path.startsWith('/orders/')
            ? '订单详情'
            : known
              ? '私人咖啡馆'
              : '找不到页面')) +
      ' · ' +
      (menu?.shop.name || '杯叙');
  }, [path, menu?.shop.name, known]);
  return (
    <div
      className={'screen ' + (/\/(login|register|customize|orders\/)/.test(path) ? 'no-nav' : '')}
    >
      {loading ? (
        <Loading />
      ) : !known ? (
        <Empty title="找不到这一页" text="回到菜单继续选一杯吧。">
          <Link className="text-action" to={session.owner ? '/owner/board' : '/menu'}>
            返回{session.owner ? '制作台' : '菜单'}
          </Link>
        </Empty>
      ) : path.startsWith('/owner') ? (
        <AdminRoutes />
      ) : (
        <FriendRoutes />
      )}
    </div>
  );
}
createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <AppProvider>
      <App />
    </AppProvider>
  </ErrorBoundary>,
);
