import {createRoot} from 'react-dom/client';
import {AppProvider,useApp,Link} from './core';
import {Loading,Empty} from './ui';
import FriendRoutes from './friend';
import AdminRoutes from './admin';
import './styles.css';
function App(){const {loading,path}=useApp();return <main className={'screen '+(/\/(login|register|customize|orders\/|owner\/login)/.test(path)?'no-nav':'')}>{loading?<Loading/>:path.startsWith('/owner')?<AdminRoutes/>:<FriendRoutes/>}</main>;}
createRoot(document.getElementById('root')!).render(<AppProvider><App/></AppProvider>);
