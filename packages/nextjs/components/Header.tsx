"use client";

import React, {useCallback, useRef, useState} from "react";
import Image from "next/image";
import Link from "next/link";
import {usePathname} from "next/navigation";
import { Bars3Icon, BugAntIcon, DocumentPlusIcon, GlobeAsiaAustraliaIcon, HomeIcon } from "@heroicons/react/24/outline";
import {FaucetButton, RainbowKitCustomConnectButton} from "~~/components/scaffold-eth";
import {useOutsideClick, useScaffoldReadContract} from "~~/hooks/scaffold-eth";
import {useAccount} from "wagmi";

type HeaderMenuLink = {
    label: string;
    href: string;
    icon?: React.ReactNode;
};

export const defaultLinks: HeaderMenuLink[] = [
    {
        label: "Home",
        href: "/",
        icon: <HomeIcon className="h-4 w-4"/>
    }

]

export const adminLinks: HeaderMenuLink[] = [
    {
        label: "Create Market",
        href: "/create-market",
        icon: <DocumentPlusIcon className="h-4 w-4"/>
    },
    {
        label: "Oracles",
        href: "/oracles",
        icon: <GlobeAsiaAustraliaIcon className="h-4 w-4"/>
    },
    {
        label: "Debug Contracts",
        href: "/debug",
        icon: <BugAntIcon className="h-4 w-4"/>
    }
];

// Constants defined on Master contract
const ADMIN_ROLE = "0xa49807205ce4d355092ef5a8a18f56e8913cf4a201fbe287825b095693c21775";
// const CALLER_ROLE = "0x843c3a00fa95510a35f425371231fd3fe4642e719cb4595160763d6d02594b50";
// const MARKET_CREATOR_ROLE = "0xd3065a24ad9e7725d223007135762d2902038999e3e5829146654498a58d9795";

export const HeaderMenuLinks = () => {
    const pathname = usePathname();

    // Check connected address role and enable debug link
    const {address: connectedAddress} = useAccount();
    const {data: isAdmin} = useScaffoldReadContract({
        contractName: "PrecogMasterV8", functionName: "hasRole", args: [ADMIN_ROLE, connectedAddress]
    });

    // Create the menu links array based on admin status
    // By default we sent defaultLinks only, if the connected address is admin, we add the other links
    const menuLinks = isAdmin ? [...defaultLinks, ...adminLinks] : defaultLinks;

    return (
        <>
            {menuLinks.map(({label, href, icon}) => {
                const isActive = pathname === href;
                return (
                    <li key={href}>
                        <Link
                            href={href}
                            passHref
                            className={`${
                                isActive ? "bg-secondary shadow-md" : ""
                            } hover:bg-secondary hover:shadow-md focus:!bg-secondary active:!text-neutral py-1.5 px-3 text-sm rounded-full gap-2 grid grid-flow-col`}
                        >
                            {icon}
                            <span>{label}</span>
                        </Link>
                    </li>
                );
            })}
        </>
    );
};

/**
 * Site header
 */
export const Header = () => {
    const [isDrawerOpen, setIsDrawerOpen] = useState(false);
    const burgerMenuRef = useRef<HTMLDivElement>(null);
    useOutsideClick(
        burgerMenuRef,
        useCallback(() => setIsDrawerOpen(false), []),
    );

    return (
        <div
            className="sticky lg:static top-0 navbar bg-base-100 min-h-0 flex-shrink-0 justify-between z-20 shadow-md shadow-secondary px-0 sm:px-2">
            <div className="navbar-start w-auto lg:w-1/2">
                <div className="lg:hidden dropdown" ref={burgerMenuRef}>
                    <label
                        tabIndex={0}
                        className={`ml-1 btn btn-ghost ${isDrawerOpen ? "hover:bg-secondary" : "hover:bg-transparent"}`}
                        onClick={() => {
                            setIsDrawerOpen(prevIsOpenState => !prevIsOpenState);
                        }}
                    >
                        <Bars3Icon className="h-1/2"/>
                    </label>
                    {isDrawerOpen && (
                        <ul
                            tabIndex={0}
                            className="menu menu-compact dropdown-content mt-3 p-2 shadow bg-base-100 rounded-box w-52"
                            onClick={() => {
                                setIsDrawerOpen(false);
                            }}
                        >
                            <HeaderMenuLinks/>
                        </ul>
                    )}
                </div>
                <Link href="/" passHref className="hidden lg:flex items-center gap-2 ml-4 mr-6 shrink-0">
                    <div className="flex relative w-10 h-10">
                        <Image alt="Precog Core logo" className="cursor-pointer" fill src="/precogLogoSq.svg"/>
                    </div>
                    <div className="flex flex-col">
                        <span className="font-bold leading-tight">Precog</span>
                        <span className="text-xs">DEV</span>
                    </div>
                </Link>
                <ul className="hidden lg:flex lg:flex-nowrap menu menu-horizontal px-1 gap-2">
                    <HeaderMenuLinks/>
                </ul>
            </div>
            <div className="navbar-end flex-grow mr-4">
                <RainbowKitCustomConnectButton/>
                <FaucetButton/>
            </div>
        </div>
    );
};
